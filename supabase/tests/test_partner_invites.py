#!/usr/bin/env python3
"""
Tests for supabase/migrations/20260921120000_partner_invites.sql
(named-invite model, rev C).

Runs the migration against an embedded Postgres (pgserver) with a stubbed
auth.uid() (Supabase's JWT reader) backed by a session setting, then proves:

  1. create (named) -> valid redeem (name + code, case-insensitive) returns owner id
  2. wrong name = invalid ('invalid_code'), same as wrong code; used code invalid
  3. unknown code rejected ('invalid_code')
  4. each create mints a FRESH code (no idempotent single-code)
  5. codes unique + unambiguous 6-char alphabet
  6. 5-cap: pending + accepted count; 6th create fails 'max_partners_reached';
     revoking one invite frees a slot
  7. my_partner_invites(): owner list read — id, name, status
     (pending/accepted); revoked excluded; other owners see nothing
  8. revoke_partner(invite_id): per-invite revoke; revoked partner reads stop,
     link NULL; other invites unaffected; non-owner / bad id / unauth fail
  9. RLS isolation: partner reads only the linked owner's shared/export
     events (never private, never another owner's, never deleted)
 10. create requires a name ('name_required'); empty name never creates a row
 11. legacy experiment table with NOT NULL token_hash (no default):
     the migration relaxes it so create_partner_invite() works;
     contract columns keep NOT NULL

Usage: python3 supabase/tests/test_partner_invites.py
Requires: pip install pgserver "psycopg[binary]"
"""
import re
import shutil
import sys
import uuid

import pgserver
from psycopg import connect
from psycopg.errors import Error as PgError

REPO = "/home/hatch/workspace/nurture-v12"
MIGRATION = f"{REPO}/supabase/migrations/20260921120000_partner_invites.sql"

OWNER_A = str(uuid.uuid4())
OWNER_B = str(uuid.uuid4())
PARTNER = str(uuid.uuid4())
STRANGER = str(uuid.uuid4())

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


def as_user(conn, uid):
    conn.execute("SELECT set_config('app.test_uid', %s, false)", (uid,))


def err_code(fn_call, *args):
    """Run fn_call(*args); return ('ok', value) or ('err', machine error code).

    Catches every psycopg Error (not just RAISE EXCEPTION) so schema-level
    failures like not-null violations report as ('err', …) instead of
    aborting the suite — the legacy token_hash regression relies on this.
    """
    try:
        row = fn_call(*args)
        return ("ok", row)
    except PgError as e:
        m = re.search(r"(\w+)$", str(e).strip().split("\n")[0])
        return ("err", m.group(1) if m else str(e))


def call_create(conn, name):
    def go(n):
        return conn.execute("SELECT * FROM create_partner_invite(%s)", (n,)).fetchone()
    return err_code(go, name)


def call_redeem(conn, code, name):
    def go(c, n):
        return conn.execute("SELECT redeem_partner_invite(%s, %s)", (c, n)).fetchone()
    return err_code(go, code, name)


def call_revoke(conn, invite_id):
    def go(i):
        conn.execute("SELECT revoke_partner(%s)", (i,)).fetchone()
        return ("void",)
    return err_code(go, invite_id)


def call_invites(conn):
    return conn.execute(
        "SELECT invite_id::text, partner_name, status FROM my_partner_invites()").fetchall()


def main():
    shutil.rmtree("/tmp/pgtest-partner", ignore_errors=True)
    srv = pgserver.get_server("/tmp/pgtest-partner")
    conn = connect(srv.get_uri())
    conn.autocommit = True

    # --- test scaffolding (NOT part of the migration) ---------------------
    conn.execute("CREATE ROLE anon NOLOGIN")
    conn.execute("CREATE ROLE authenticated NOLOGIN")
    conn.execute("CREATE SCHEMA IF NOT EXISTS auth")
    conn.execute("""
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('app.test_uid', true), '')::uuid
        $$""")
    # minimal events table: the columns the migration's functions touch
    conn.execute("""
        CREATE TABLE events (
          id uuid PRIMARY KEY,
          user_id uuid,
          pregnancy_id uuid,
          type text,
          occurred_at timestamptz,
          visibility text DEFAULT 'private',
          data jsonb DEFAULT '{}',
          idempotency_key text,
          deleted_at timestamptz,
          updated_at timestamptz
        )""")

    # --- apply the migration ----------------------------------------------
    print("applying migration…")
    conn.execute(open(MIGRATION).read())
    print("migration applied cleanly (re-run check at the end)")

    # --- 1. named create -> redeem (name binds, case-insensitive) -----------
    print("named create + redeem:")
    as_user(conn, OWNER_A)
    status, row = call_create(conn, "Sam")
    check("create returns code only", status == "ok" and len(row) == 1, f"{status}:{row}")
    code_a = row[0]
    check("code is 6 chars", len(code_a) == 6, code_a)
    check("code alphabet unambiguous",
          re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", code_a) is not None, code_a)

    as_user(conn, PARTNER)
    status, val = call_redeem(conn, code_a.lower() + " ", "  sAm ")  # case/space tolerant
    check("valid name+code redeem returns owner id",
          status == "ok" and str(val[0]) == OWNER_A, f"{status}:{val}")
    check("my_partner_link -> owner",
          str(conn.execute("SELECT my_partner_link()").fetchone()[0]) == OWNER_A)

    # --- 2. wrong name / used code / unknown code ---------------------------
    print("name binding:")
    as_user(conn, OWNER_B)
    code_b = call_create(conn, "Maya")[1][0]
    as_user(conn, STRANGER)
    status, val = call_redeem(conn, code_b, "Noah")  # right code, WRONG name
    check("wrong name rejected as invalid_code",
          status == "err" and val == "invalid_code", f"{status}:{val}")
    status, val = call_redeem(conn, code_b, "maya")  # right code, right name
    check("right name (case-insensitive) redeems",
          status == "ok" and str(val[0]) == OWNER_B, f"{status}:{val}")
    status, val = call_redeem(conn, code_b, "Maya")  # already used
    check("used code rejected as invalid_code",
          status == "err" and val == "invalid_code", f"{status}:{val}")
    status, val = call_redeem(conn, "ZZZZZZ", "Maya")  # unknown code
    check("unknown code rejected", status == "err" and val == "invalid_code",
          f"{status}:{val}")
    # owner can't redeem their own invite as a partner
    as_user(conn, OWNER_A)
    code_self = call_create(conn, "Self")[1][0]
    status, val = call_redeem(conn, code_self, "Self")
    check("owner cannot self-redeem", status == "err" and val == "invalid_code",
          f"{status}:{val}")

    # --- 3. fresh code per create (no idempotent single-code) ----------------
    print("fresh code per create:")
    as_user(conn, OWNER_A)
    c1 = call_create(conn, "One")[1][0]
    c2 = call_create(conn, "Two")[1][0]
    check("second create mints a FRESH code", c1 != c2, f"{c1} vs {c2}")

    # --- 4. uniqueness over many codes --------------------------------------
    print("code uniqueness:")
    seen = set()
    owner_u = str(uuid.uuid4())
    as_user(conn, owner_u)
    for i in range(200):
        # stay under the 5-cap: redeem then revoke each code right away
        name = f"P{i}"
        c = conn.execute("SELECT code FROM create_partner_invite(%s)", (name,)).fetchone()[0]
        seen.add(c)
        as_user(conn, str(uuid.uuid4()))
        conn.execute("SELECT redeem_partner_invite(%s, %s)", (c, name))
        as_user(conn, owner_u)
        iid = conn.execute(
            "SELECT invite_id FROM my_partner_invites() WHERE partner_name = %s",
            (name,)).fetchone()[0]
        conn.execute("SELECT revoke_partner(%s)", (iid,))
    check("200 minted codes all unique", len(seen) == 200, f"{len(seen)}")

    # --- 5. my_partner_invites: pending vs accepted --------------------------
    print("owner list read:")
    owner_l = str(uuid.uuid4())
    as_user(conn, owner_l)
    call_create(conn, "Pending1")
    call_create(conn, "Pending2")
    ca = call_create(conn, "Accepted1")[1][0]
    partner_l = str(uuid.uuid4())
    as_user(conn, partner_l)
    call_redeem(conn, ca, "Accepted1")
    as_user(conn, owner_l)
    rows = {r[1]: (r[0], r[2]) for r in call_invites(conn)}
    check("list has 3 named invites", len(rows) == 3, rows.keys())
    check("pending shows status pending",
          rows["Pending1"][1] == "pending" and rows["Pending2"][1] == "pending")
    check("accepted shows status accepted", rows["Accepted1"][1] == "accepted")
    check("list rows carry invite ids", all(r[0] for r in rows.values()))
    # other owner sees only their own
    as_user(conn, OWNER_A)
    names = {r[1] for r in call_invites(conn)}
    check("owners see only their own invites", "Pending1" not in names, names)

    # --- 6. 5-cap (pending + accepted) ---------------------------------------
    print("5-cap:")
    owner_5 = str(uuid.uuid4())
    as_user(conn, owner_5)
    for i in range(5):
        st, _ = call_create(conn, f"N{i}")
        assert st == "ok", st
    # redeem two of them: still 5 live (pending + accepted both count)
    n0 = _code_of(conn, owner_5, "N0")
    n1 = _code_of(conn, owner_5, "N1")
    as_user(conn, STRANGER)
    status, val = call_redeem(conn, n0, "N0")
    check("redeem one invite (still counts toward 5)", status == "ok", f"{status}:{val}")
    p2 = str(uuid.uuid4())
    as_user(conn, p2)
    status, val = call_redeem(conn, n1, "N1")
    check("redeem second invite", status == "ok", f"{status}:{val}")
    as_user(conn, owner_5)
    status, val = call_create(conn, "Sixth")
    check("6th invite rejected as max_partners_reached",
          status == "err" and val == "max_partners_reached", f"{status}:{val}")
    # revoking one invite frees a slot
    invites = call_invites(conn)
    status, val = call_revoke(conn, invites[0][0])
    check("per-invite revoke ok", status == "ok", f"{status}:{val}")
    status, row = call_create(conn, "Sixth")
    check("create works again after revoke", status == "ok", f"{status}:{val}")
    # revoked invite is excluded from the list
    names = {r[1] for r in call_invites(conn)}
    check("revoked invite excluded from list", "N0" not in names, names)

    # --- 7. per-invite revocation --------------------------------------------
    print("revocation:")
    as_user(conn, owner_l)
    accepted_id = rows["Accepted1"][0]
    status, val = call_revoke(conn, accepted_id)
    check("owner revokes accepted invite", status == "ok", f"{status}:{val}")
    as_user(conn, partner_l)
    check("revoked partner link is NULL",
          conn.execute("SELECT my_partner_link()").fetchone()[0] is None)
    # pending invite of the same owner is untouched
    as_user(conn, owner_l)
    names = {r[1] for r in call_invites(conn)}
    check("pending invites survive a sibling revoke",
          "Pending1" in names and "Accepted1" not in names, names)
    # failure modes
    status, val = call_revoke(conn, str(uuid.uuid4()))  # unknown id
    check("revoke unknown id fails", status == "err" and val == "no_partner_link",
          f"{status}:{val}")
    as_user(conn, STRANGER)  # not the owner
    status, val = call_revoke(conn, invites[0][0])
    check("non-owner revoke fails", status == "err" and val == "no_partner_link",
          f"{status}:{val}")
    as_user(conn, "")
    status, val = call_revoke(conn, accepted_id)
    check("unauthenticated revoke fails", status == "err" and val == "not_authenticated",
          f"{status}:{val}")

    # --- 8. partner read isolation --------------------------------------------
    print("partner read isolation:")
    as_user(conn, OWNER_A)
    ev = lambda v, o: conn.execute(
        "INSERT INTO events (id, user_id, type, occurred_at, visibility, updated_at) "
        "VALUES (%s, %s::uuid, 'log', now(), %s, now())",
        (str(uuid.uuid4()), o, v))
    ev("private", OWNER_A)
    ev("shared", OWNER_A)
    ev("export", OWNER_A)
    ev("shared", OWNER_B)   # another owner's shared entry
    conn.execute(
        "INSERT INTO events (id, user_id, type, occurred_at, visibility, deleted_at, updated_at)"
        " VALUES (%s, %s::uuid, 'log', now(), 'shared', now(), now())",
        (str(uuid.uuid4()), OWNER_A))  # tombstoned shared entry

    as_user(conn, PARTNER)
    rows = conn.execute("SELECT user_id::text, visibility FROM get_shared_events()").fetchall()
    vis = sorted(r[1] for r in rows)
    owners = {r[0] for r in rows}
    check("partner sees only shared+export", vis == ["export", "shared"], vis)
    check("partner sees only linked owner", owners == {OWNER_A}, owners)

    nobody = str(uuid.uuid4())  # never redeemed anything — truly unlinked
    as_user(conn, nobody)
    rows = conn.execute("SELECT * FROM get_shared_events()").fetchall()
    check("unlinked user sees nothing", rows == [])

    # --- 9. name required ------------------------------------------------------
    print("name required:")
    as_user(conn, OWNER_B)
    status, val = call_create(conn, "   ")
    check("empty name rejected as name_required",
          status == "err" and val == "name_required", f"{status}:{val}")
    status, val = call_create(conn, "")
    check("blank name rejected", status == "err" and val == "name_required",
          f"{status}:{val}")

    # unauthenticated create rejected
    as_user(conn, "")
    try:
        conn.execute("SELECT * FROM create_partner_invite(%s)", ("X",)).fetchone()
        check("create without auth rejected", False)
    except PgError as e:
        check("create without auth rejected", "not_authenticated" in str(e))

    # --- idempotent re-run of the whole migration ------------------------------
    print("migration re-run:")
    try:
        conn.execute(open(MIGRATION).read())
        check("migration is idempotent", True)
    except Exception as e:
        check("migration is idempotent", False, str(e)[:120])

    # --- 10. legacy experiment table: NOT NULL token_hash, no default -------
    # Production's old table carried a legacy NOT NULL token_hash column that
    # the named-invite INSERT never populates. The migration must relax it;
    # without the sweep, create_partner_invite() fails with a not-null
    # violation (reproduced against production, Sept 21 2026).
    print("legacy table sweep:")
    conn.execute("DROP TABLE partner_invites")
    # Faithful to production's old experiment table: it carried a legacy
    # NOT NULL token_hash column (no default) and no code/owner columns;
    # id already has a default there (the production failure named
    # token_hash, never id).
    conn.execute("""
        CREATE TABLE partner_invites (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          token_hash TEXT NOT NULL,
          legacy_note TEXT
        )""")
    try:
        conn.execute(open(MIGRATION).read())
        check("migration applies over the legacy experiment table", True)
    except Exception as e:
        check("migration applies over the legacy experiment table", False,
              str(e)[:120])
    as_user(conn, OWNER_A)
    status, row = call_create(conn, "Legacy")
    check("create works despite legacy token_hash",
          status == "ok" and len(row[0]) == 6, f"{status}:{row}")
    nullable = conn.execute(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = 'partner_invites' "
        "AND column_name = 'token_hash'").fetchone()[0]
    check("legacy token_hash relaxed to nullable", nullable == "YES", nullable)
    notnull = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = 'partner_invites' "
        "AND is_nullable = 'NO'").fetchall()}
    check("contract column partner_name keeps NOT NULL",
          "partner_name" in notnull, sorted(notnull))

    print(f"\n{passed} passed, {failed} failed")
    srv.cleanup()
    sys.exit(1 if failed else 0)


def _code_of(conn, owner, name):
    """Helper: fetch the live invite code for (owner, name) for tests."""
    row = conn.execute(
        "SELECT code FROM partner_invites WHERE owner_user_id = %s::uuid AND partner_name = %s AND revoked_at IS NULL",
        (owner, name)).fetchone()
    return row[0] if row else None


if __name__ == "__main__":
    main()
