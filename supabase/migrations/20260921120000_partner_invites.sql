-- Migration: partner sharing — NAMED invite codes + partners list (max 5).
--
-- Sept 2026 (rev C): Anuraj approved the named-invite model (mockup 33),
-- superseding the one-partner implementation. Every invite is named at
-- creation ("who is this code for?"); the partner enters name + code and
-- verification binds the two (wrong name = invalid, same as wrong code).
-- The You-tab card is a partners list: pending named invites show
-- "Name · Invited", accepted partners show name + remove. Max 5 partners
-- (pending + accepted), enforced server-side too.
--
--   - partner_invites table (one row per named invite; new partner_name column)
--   - create_partner_invite(p_name) — owner-only, mints a fresh named invite
--   - redeem_partner_invite(p_code, p_name) — partner redeems; name binds
--     (LOWER() compare); unknown code, used code, or wrong name all fail
--     with 'invalid_code'
--   - revoke_partner(p_invite_id) — owner-only per-invite revocation
--   - my_partner_invites() — owner's list read (invite id, name, status)
--   - my_partner_link() — which owner I am linked to as a partner (or NULL)
--   - get_shared_events() — partner's read path: owner's shared/export
--     events only
--
-- Design notes (Anuraj's decisions, Sept 21, 2026):
--   - Codes: 6 chars, uppercase alphanumeric minus ambiguous 0/O/1/I.
--     ~2.8 trillion combinations; collision retry is belt-and-braces.
--   - NO expiry. A code is either valid or invalid — nothing in between.
--   - Codes are SINGLE-USE: the moment a code is redeemed it can never be
--     redeemed again. An unknown code, an already-used code, and a wrong
--     name all fail with 'invalid_code'.
--   - Named invites only: create requires a name; a code abandoned before
--     naming never exists server-side, so unused/unnamed codes never appear
--     in the partners list.
--   - Max 5 named invites (pending + accepted) per owner, enforced in
--     create_partner_invite() ('max_partners_reached').
--   - Both parties are Supabase anonymous users (distinct auth.uid()).
--   - Partner NEVER gets direct table access to events: reads go through the
--     SECURITY DEFINER get_shared_events(), which returns only the linked
--     owner's events with visibility IN ('shared','export') and
--     deleted_at IS NULL. The existing owner-only RLS on events is untouched.
--   - RLS on partner_invites: owners can SELECT their own rows only. All
--     writes go through the SECURITY DEFINER functions (no INSERT/UPDATE/
--     DELETE policies for anon/authenticated roles).
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the
-- dashboard SQL editor. Idempotent: safe to re-run.
--
-- NOTE: this migration was never applied to production — it is repo-only
-- until Anuraj reviews and approves the production apply.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_by   UUID,
  redeemed_at   TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

-- Named invites (rev C): every code is created for a named partner.
ALTER TABLE partner_invites ADD COLUMN IF NOT EXISTS partner_name TEXT;
-- Backfill for rows predating the column (none expected in production —
-- this migration never shipped — but re-runs must stay safe).
UPDATE partner_invites SET partner_name = 'Partner' WHERE partner_name IS NULL;
ALTER TABLE partner_invites ALTER COLUMN partner_name SET NOT NULL;
ALTER TABLE partner_invites ALTER COLUMN partner_name SET DEFAULT 'Partner';

CREATE INDEX IF NOT EXISTS partner_invites_code_idx ON partner_invites (code);
CREATE INDEX IF NOT EXISTS partner_invites_owner_idx ON partner_invites (owner_user_id);
CREATE INDEX IF NOT EXISTS partner_invites_redeemed_by_idx ON partner_invites (redeemed_by);

ALTER TABLE partner_invites ENABLE ROW LEVEL SECURITY;

-- Owners can read their own invites. No direct-write policies: all writes go
-- through the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS partner_invites_owner_select ON partner_invites;
CREATE POLICY partner_invites_owner_select
  ON partner_invites FOR SELECT
  USING (auth.uid() = owner_user_id);

-- ---------------------------------------------------------------------------
-- 2. Code generation (private helper)
-- ---------------------------------------------------------------------------

-- 6-char codes from a 32-symbol alphabet (no 0/O/1/I). Randomness comes
-- from gen_random_uuid() (built-in, no extensions needed): 8 bits per char
-- (two hex chars), and 256 is an exact multiple of 32, so the modulo
-- mapping is bias-free.
CREATE OR REPLACE FUNCTION _partner_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   TEXT := '';
  i        INT;
  hex      TEXT := replace(gen_random_uuid()::text, '-', ''); -- 32 hex chars
BEGIN
  FOR i IN 0..5 LOOP
    -- 8 bits from two hex chars; 256 is an exact multiple of 32: no bias.
    result := result || substr(alphabet, (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int % 32) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. create_partner_invite(p_name) — owner-only, named, max 5
-- ---------------------------------------------------------------------------
-- Mints a FRESH named invite on every call (no idempotent single-code).
-- Enforces the 5-cap: named invites (pending + accepted, i.e. not revoked)
-- per owner; beyond that raises 'max_partners_reached'. Codes never expire.

-- Old signatures (single-code / single-link model) are superseded by the
-- named model.
DROP FUNCTION IF EXISTS create_partner_invite();
DROP FUNCTION IF EXISTS create_partner_invite(TEXT);

CREATE FUNCTION create_partner_invite(p_name TEXT)
RETURNS TABLE (code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner      UUID := auth.uid();
  clean_name TEXT := trim(p_name);
  live_count INT;
  new_code   TEXT;
BEGIN
  IF owner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF clean_name IS NULL OR clean_name = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  -- Keep the label short and single-line (UI renders it in a list row).
  clean_name := left(clean_name, 30);

  -- 5-cap counts named invites, pending + accepted (revoked rows don't count).
  SELECT count(*) INTO live_count
  FROM partner_invites
  WHERE owner_user_id = owner
    AND revoked_at IS NULL;

  IF live_count >= 5 THEN
    RAISE EXCEPTION 'max_partners_reached' USING ERRCODE = 'P0001';
  END IF;

  LOOP
    new_code := _partner_invite_code();
    BEGIN
      INSERT INTO partner_invites (code, owner_user_id, partner_name)
      VALUES (new_code, owner, clean_name);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- collision: try again
    END;
  END LOOP;

  code := new_code;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. redeem_partner_invite(p_code, p_name) — partner redeems, name binds
-- ---------------------------------------------------------------------------
-- Validates the code AND the partner's name together (LOWER() compare):
-- unknown code, already-used code, and wrong name ALL fail as
-- 'invalid_code' (valid-or-invalid only). On success returns the owner's
-- user id (the link grant).

-- Old single-arg signature (no name binding) is superseded.
DROP FUNCTION IF EXISTS redeem_partner_invite(TEXT);

CREATE OR REPLACE FUNCTION redeem_partner_invite(p_code TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partner UUID := auth.uid();
  invite  RECORD;
BEGIN
  IF partner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO invite
  FROM partner_invites
  WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  IF invite.redeemed_by IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  -- The name binds to the code: wrong name is invalid, same as a wrong code.
  IF invite.partner_name IS NULL
     OR lower(trim(p_name)) <> lower(invite.partner_name) THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  -- The owner can't redeem their own invite as a partner.
  IF partner = invite.owner_user_id THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  UPDATE partner_invites
  SET redeemed_by = partner,
      redeemed_at = now()
  WHERE id = invite.id;

  RETURN invite.owner_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. revoke_partner(p_invite_id) — owner severs one partner link
-- ---------------------------------------------------------------------------
-- Callable by the owning user only, per invite. After revocation the
-- partner's reads via get_shared_events() return nothing and
-- my_partner_link() returns NULL for them. Machine-readable errors:
--   not_authenticated — no caller identity
--   no_partner_link   — no such active invite owned by the caller

-- Old no-arg signature (single-link model) is superseded.
DROP FUNCTION IF EXISTS revoke_partner();
DROP FUNCTION IF EXISTS revoke_partner(UUID);

CREATE FUNCTION revoke_partner(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner UUID := auth.uid();
BEGIN
  IF owner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  UPDATE partner_invites
  SET revoked_at = now()
  WHERE id = p_invite_id
    AND owner_user_id = owner
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_partner_link' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. my_partner_invites() — the owner's partners list read
-- ---------------------------------------------------------------------------
-- Returns the owner's live named invites: id, name, and status
-- ('pending' until redeemed, 'accepted' after). Revoked invites are excluded
-- (they never appear in the list). Unnamed codes can't exist: create
-- requires a name, so the list shows named invites only.

CREATE OR REPLACE FUNCTION my_partner_invites()
RETURNS TABLE (invite_id UUID, partner_name TEXT, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id,
         partner_invites.partner_name,
         CASE WHEN redeemed_by IS NULL THEN 'pending' ELSE 'accepted' END,
         partner_invites.created_at
  FROM partner_invites
  WHERE owner_user_id = auth.uid()
    AND revoked_at IS NULL
  ORDER BY partner_invites.created_at ASC;
$$;

-- ---------------------------------------------------------------------------
-- 7. my_partner_link() — which owner am I linked to (NULL if none)
-- ---------------------------------------------------------------------------
-- Only counts links that have not been revoked by the owner.

CREATE OR REPLACE FUNCTION my_partner_link()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT owner_user_id
  FROM partner_invites
  WHERE redeemed_by = auth.uid()
    AND revoked_at IS NULL
  ORDER BY redeemed_at DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_shared_events() — the partner's read path
-- ---------------------------------------------------------------------------
-- Returns the linked owner's events with visibility 'shared' or 'export',
-- excluding tombstoned (deleted) rows, newest first. Revoked links see
-- nothing. The partner never touches the events table directly; the
-- existing owner-only RLS on events is unchanged.

CREATE OR REPLACE FUNCTION get_shared_events()
RETURNS SETOF events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT e.*
  FROM events e
  WHERE e.user_id = (
      SELECT owner_user_id
      FROM partner_invites
      WHERE redeemed_by = auth.uid()
        AND revoked_at IS NULL
      ORDER BY redeemed_at DESC
      LIMIT 1
    )
    AND e.visibility IN ('shared', 'export')
    AND e.deleted_at IS NULL
  ORDER BY e.occurred_at DESC;
$$;

-- Lock down the helper so only the intended roles can call these.
REVOKE ALL ON FUNCTION _partner_invite_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_partner_invite(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION redeem_partner_invite(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_partner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION my_partner_invites() FROM PUBLIC;
REVOKE ALL ON FUNCTION my_partner_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_shared_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_partner_invite(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_partner_invite(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION revoke_partner(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION my_partner_invites() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION my_partner_link() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shared_events() TO anon, authenticated;
