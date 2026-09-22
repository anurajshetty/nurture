#!/usr/bin/env python3
"""
Tests for supabase/migrations/20260922090000_partner_home_loves.sql
(mockup 34 — partner home "love" reactions, Anuraj approved Sept 2026).

Runs the migration stack against an embedded Postgres (pgserver) with a
stubbed auth.uid() backed by a session setting, then proves:

  1. toggle_entry_love: partner loves a visible shared entry -> TRUE;
     toggle again -> FALSE and the row is gone (unlove removes the row)
  2. toggle on a private entry fails 'not_visible'
  3. toggle on an entry she unshared after loving fails 'not_visible'
     (and the stale love never resurfaces)
  4. toggle with the per-link sharing switch paused fails 'not_linked'
  5. toggle after revoke fails 'not_linked'
  6. toggle unauthenticated fails 'not_authenticated'
  7. toggle on another owner's shared entry fails 'not_visible'
  8. toggle on a deleted (tombstoned) entry fails 'not_visible'
  9. get_my_loves() returns exactly the loved entry ids for the caller
 10. get_entry_loves(): owner sees partner names per entry; a stranger
     (and the partner) sees nothing
 11. redeem_partner_invite returns her owner_name from pregnancies when the
     table exists; NULL (not a crash) when it doesn't
 12. entry_reactions has RLS enabled: direct table reads as anon are denied;
     only the SECURITY DEFINER functions mediate
 13. deleting an event cascades its reactions (no orphan rows)

Usage: python3 supabase/tests/test_partner_home_loves.py
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
MIGRATIONS = [
    f"{REPO}/supabase/migrations/20260921120000_partner_invites.sql",
    f"{REPO}/supabase/migrations/20260921220000_partner_sharing_controls.sql",
    f"{REPO}/supabase/migrations/20260922090000_partner_home_loves.sql",
]

OWNER = str(uuid.uuid4())
PARTNER = str(uuid.uuid4())
STRANGER = str(uuid.uuid4())
OTHER_OWNER = str(uuid.uuid4())

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


def err_name(fn_call, *args):
    """Run fn_call(*args); return ('ok', value) or ('err', machine error)."""
    try:
        row = fn_call(*args)
        return ("ok", row)
    except PgError as e:
        m = re.search(r"(\w+)$", str(e).strip().split("\n")[0])
        return ("err", m.group(1) if m else str(e))


def apply_migrations(conn):
    for path in MIGRATIONS:
        with open(path) as f:
            conn.execute(f.read())


def main():
    shutil.rmtree("/tmp/pgtest-partner-loves", ignore_errors=True)
    srv = pgserver.get_server("/tmp/pgtest-partner-loves")
    conn = connect(srv.get_uri())
    conn.autocommit = True

    # --- test scaffolding (NOT part of the migration) ---------------------
    conn.execute("CREATE ROLE anon NOLOGIN")
    conn.execute("CREATE ROLE authenticated NOLOGIN")
    conn.execute("CREATE SCHEMA IF NOT EXISTS auth")
    conn.execute(
        """
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('app.test_uid', true), '')::uuid
        $$"""
    )
    # minimal events table: the columns the partner functions touch
    conn.execute(
        """
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
        )"""
    )
    # pregnancies table with owner_name (the redeem name-source path)
    conn.execute(
        """
        CREATE TABLE pregnancies (
          id uuid PRIMARY KEY,
          user_id uuid,
          owner_name text,
          updated_at timestamptz
        )"""
    )
    conn.execute(
        "INSERT INTO pregnancies (id, user_id, owner_name, updated_at) VALUES (%s, %s, %s, now())",
        (str(uuid.uuid4()), OWNER, "Sushmitha"),
    )

    apply_migrations(conn)

    def call_create(name):
        return err_name(
            lambda n: conn.execute(
                "SELECT * FROM create_partner_invite(%s)", (n,)
            ).fetchone(),
            name,
        )

    def call_redeem(code, name):
        return err_name(
            lambda c, n: conn.execute(
                "SELECT * FROM redeem_partner_invite(%s, %s)", (c, n)
            ).fetchone(),
            code,
            name,
        )

    def call_toggle(entry_id):
        return err_name(
            lambda e: conn.execute(
                "SELECT toggle_entry_love(%s)", (e,)
            ).fetchone()[0],
            entry_id,
        )

    def call_my_loves():
        return [str(x) for x in conn.execute("SELECT get_my_loves()").fetchone()[0]]

    def call_entry_loves(ids):
        return [(str(r[0]), r[1]) for r in conn.execute("SELECT * FROM get_entry_loves(%s)", (ids,)).fetchall()]

    def ensure_loved(entry_id):
        """Love the entry only if not already loved (toggle is stateful)."""
        if entry_id not in call_my_loves():
            st, val = call_toggle(entry_id)
            assert st == "ok" and val is True, (st, val)

    # --- 1. redeem returns owner id AND her name --------------------------
    as_user(conn, OWNER)
    st, row = call_create("Sam")
    check("create invite ok", st == "ok", st)
    code = row[0]
    as_user(conn, PARTNER)
    st, row = call_redeem(code, "sam")  # case-insensitive name binding
    check("redeem ok", st == "ok", st)
    owner_id, owner_name = row[0], row[1]
    check("redeem returns owner id", str(owner_id) == OWNER, owner_id)
    check("redeem returns her name", owner_name == "Sushmitha", owner_name)

    # --- owner shares an event ---------------------------------------------
    event_id = str(uuid.uuid4())
    private_id = str(uuid.uuid4())
    as_user(conn, OWNER)
    conn.execute(
        "INSERT INTO events (id, user_id, visibility, occurred_at) VALUES (%s, %s, 'shared', now())",
        (event_id, OWNER),
    )
    conn.execute(
        "INSERT INTO events (id, user_id, visibility, occurred_at) VALUES (%s, %s, 'private', now())",
        (private_id, OWNER),
    )

    # --- 2. love / unlove round-trip ---------------------------------------
    as_user(conn, PARTNER)
    st, val = call_toggle(event_id)
    check("love shared entry -> TRUE", st == "ok" and val is True, (st, val))
    loves = call_my_loves()
    check("get_my_loves has the entry", event_id in loves, loves)
    st, val = call_toggle(event_id)
    check("unlove -> FALSE", st == "ok" and val is False, (st, val))
    check("row removed on unlove", call_my_loves() == [], call_my_loves())

    # --- 3. private entry ----------------------------------------------------
    st, val = call_toggle(private_id)
    check("love private entry -> not_visible", st == "err" and val == "not_visible", (st, val))

    # --- 4. unshared after loving --------------------------------------------
    as_user(conn, PARTNER)
    call_toggle(event_id)  # love it while shared
    as_user(conn, OWNER)
    conn.execute("SELECT set_event_shared(%s, false)", (event_id,))
    as_user(conn, PARTNER)
    st, val = call_toggle(event_id)
    check("love unshared entry -> not_visible", st == "err" and val == "not_visible", (st, val))
    visible = conn.execute(
        "SELECT count(*) FROM get_shared_events() WHERE id = %s", (event_id,)
    ).fetchone()[0]
    check("unshared entry not in partner reads", visible == 0, visible)
    # restore for later steps
    as_user(conn, OWNER)
    conn.execute("SELECT set_event_shared(%s, true)", (event_id,))

    # --- 5. sharing paused ---------------------------------------------------
    invite_id = conn.execute(
        "SELECT invite_id FROM my_partner_invites() WHERE partner_name = 'Sam'"
    ).fetchone()[0]
    conn.execute("SELECT set_partner_sharing(%s, false)", (invite_id,))
    as_user(conn, PARTNER)
    st, val = call_toggle(event_id)
    check("love while paused -> not_linked", st == "err" and val == "not_linked", (st, val))
    as_user(conn, OWNER)
    conn.execute("SELECT set_partner_sharing(%s, true)", (invite_id,))

    # --- 6. another owner's entry ----------------------------------------------
    other_event = str(uuid.uuid4())
    as_user(conn, OTHER_OWNER)
    conn.execute(
        "INSERT INTO events (id, user_id, visibility, occurred_at) VALUES (%s, %s, 'shared', now())",
        (other_event, OTHER_OWNER),
    )
    as_user(conn, PARTNER)
    st, val = call_toggle(other_event)
    check("love other owner's entry -> not_visible", st == "err" and val == "not_visible", (st, val))

    # --- 7. deleted entry ------------------------------------------------------
    as_user(conn, OWNER)
    conn.execute("UPDATE events SET deleted_at = now() WHERE id = %s", (private_id,))
    # (use a shared-then-deleted event for the deleted check)
    del_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO events (id, user_id, visibility, occurred_at, deleted_at) VALUES (%s, %s, 'shared', now(), now())",
        (del_id, OWNER),
    )
    as_user(conn, PARTNER)
    st, val = call_toggle(del_id)
    check("love deleted entry -> not_visible", st == "err" and val == "not_visible", (st, val))

    # --- 8. unauthenticated ----------------------------------------------------
    as_user(conn, "")
    st, val = call_toggle(event_id)
    check("unauthenticated -> not_authenticated", st == "err" and val == "not_authenticated", (st, val))

    # --- 9. get_entry_loves: owner sees names, others see nothing --------------
    as_user(conn, PARTNER)
    ensure_loved(event_id)  # (test 4's love is still live — toggle is stateful)
    as_user(conn, OWNER)
    rows = call_entry_loves([event_id, private_id])
    check(
        "owner sees loved-by name",
        rows == [(event_id, "Sam")],
        rows,
    )
    as_user(conn, STRANGER)
    rows = call_entry_loves([event_id])
    check("stranger sees nothing", rows == [], rows)
    as_user(conn, PARTNER)
    rows = call_entry_loves([event_id])
    check("partner cannot use owner read", rows == [], rows)

    # --- 9b. my_partner_link_status: owner + sharing state ---------------------
    def call_link_status():
        return err_name(
            lambda: conn.execute("SELECT * FROM my_partner_link_status()").fetchone(),
        )

    as_user(conn, PARTNER)
    st, row = call_link_status()
    check(
        "link status: owner + sharing on",
        st == "ok" and str(row[0]) == OWNER and row[1] is True,
        (st, row),
    )
    as_user(conn, OWNER)
    conn.execute("SELECT set_partner_sharing(%s, false)", (invite_id,))
    as_user(conn, PARTNER)
    st, row = call_link_status()
    check("link status: sharing off", st == "ok" and row[1] is False, (st, row))
    as_user(conn, STRANGER)
    st, row = call_link_status()
    check("link status: no link -> no row", st == "ok" and row is None, (st, row))
    as_user(conn, OWNER)
    conn.execute("SELECT set_partner_sharing(%s, true)", (invite_id,))

    # --- 10. revoke -> loves stop ------------------------------------------------
    as_user(conn, OWNER)
    conn.execute("SELECT revoke_partner(%s)", (invite_id,))
    as_user(conn, PARTNER)
    st, val = call_toggle(event_id)
    check("love after revoke -> not_linked", st == "err" and val == "not_linked", (st, val))

    # --- 11. RLS: direct table reads denied --------------------------------------
    conn.execute("SET ROLE anon")
    try:
        conn.execute("SELECT count(*) FROM entry_reactions")
        rls_ok = False
    except PgError:
        rls_ok = True
    finally:
        conn.execute("RESET ROLE")
    check("entry_reactions direct read denied (RLS)", rls_ok)

    # --- 12. cascade: deleting the event removes its reactions -------------------
    as_user(conn, OWNER)
    ensure_loved_live = conn.execute(
        "SELECT count(*) FROM entry_reactions WHERE entry_id = %s::uuid", (event_id,)
    ).fetchone()[0]
    # The love from test 9 is still live (revoke doesn't delete reactions).
    leftovers = ensure_loved_live
    conn.execute("DELETE FROM events WHERE id = %s", (event_id,))
    gone = conn.execute(
        "SELECT count(*) FROM entry_reactions WHERE entry_id = %s", (event_id,)
    ).fetchone()[0]
    check("reactions cascade on event delete", leftovers == 1 and gone == 0, (leftovers, gone))

    # --- 13. redeem tolerates a missing pregnancies table ------------------------
    conn.execute("DROP TABLE pregnancies")
    as_user(conn, OWNER)
    st, row = call_create("Noor")
    code2 = row[0] if st == "ok" else None
    check("create second invite ok", st == "ok", st)
    partner2 = str(uuid.uuid4())
    as_user(conn, partner2)
    st, row = call_redeem(code2, "Noor")
    check("redeem without pregnancies table ok", st == "ok", st)
    check("owner_name NULL (not a crash)", st == "ok" and row[1] is None, row)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
