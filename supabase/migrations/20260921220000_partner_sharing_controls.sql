-- Migration: partner sharing controls — per-partner sharing toggle,
-- per-entry shared/private toggle, and share-new-entries default.
--
-- Sept 2026: Anuraj approved the partners-card mockup (per-partner "Sees your
-- shared entries" toggle, Remove on every row, code shown on pending rows
-- only) and the entry-sharing design (per-entry shared toggle ON by default;
-- new-log composer is text-only; everything else unchanged).
--
--   - partner_invites.sharing_enabled (per-partner toggle, default TRUE)
--   - my_partner_invites() re-created: now also returns the pending invite's
--     6-char code (NULL once accepted) and sharing_enabled
--   - set_partner_sharing(p_invite_id, p_enabled) — owner-only per-partner
--     toggle; get_shared_events() enforces it
--   - events.shared — GENERATED ALWAYS AS (visibility IN ('shared','export'))
--     STORED: can never drift from visibility; the client marks new entries
--     shared/private via visibility only
--   - set_event_shared(p_event_id, p_shared) — owner flips one of her own
--     entries between shared and private; 'export' is preserved when turning
--     sharing on, 'private' when turning it off
--   - user_share_settings — per-user default for new entries (TRUE default);
--     RLS enabled, no direct-access policies, RPC-only via get/set functions
--   - get_shared_events() replaced: also requires the linked invite's
--     sharing_enabled IS TRUE and e.shared IS TRUE (visibility filter kept);
--     revoked links still see nothing
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the
-- dashboard SQL editor. Idempotent: safe to re-run.
-- Repo-only: do NOT apply to production without Anuraj's approval.

-- ---------------------------------------------------------------------------
-- 1. partner_invites.sharing_enabled — the per-partner toggle
-- ---------------------------------------------------------------------------
-- Default TRUE matches the approved design: per-entry sharing is ON by
-- default, and each partner sees shared entries until the owner pauses them.
-- information_schema guard: safe on re-runs and on any pre-existing table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'partner_invites'
      AND column_name = 'sharing_enabled'
  ) THEN
    ALTER TABLE public.partner_invites
      ADD COLUMN sharing_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. my_partner_invites() — DROP + re-create with the wider return type
-- ---------------------------------------------------------------------------
-- Regression notes / what changed vs 20260921120000:
--   - Returns two new columns: `code` (the pending invite's 6-char code, so
--     the You-tab partners list can show code + Copy on pending rows; NULL
--     once accepted because spent single-use codes must never re-expose)
--     and `sharing_enabled` (drives the per-partner toggle UI).
--   - Signature change: DROP before CREATE (CREATE OR REPLACE cannot change
--     a function's return type).
-- Privileges are re-granted below: DROP FUNCTION wipes the old ACL entries.

DROP FUNCTION IF EXISTS my_partner_invites();

CREATE FUNCTION my_partner_invites()
RETURNS TABLE (
  invite_id       UUID,
  partner_name    TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ,
  code            TEXT,
  sharing_enabled BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id,
         partner_invites.partner_name,
         CASE WHEN redeemed_by IS NULL THEN 'pending' ELSE 'accepted' END,
         partner_invites.created_at,
         -- Spent codes never re-expose: accepted rows get NULL.
         CASE WHEN redeemed_by IS NULL THEN partner_invites.code ELSE NULL END,
         partner_invites.sharing_enabled
  FROM partner_invites
  WHERE owner_user_id = auth.uid()
    AND revoked_at IS NULL
  ORDER BY partner_invites.created_at ASC;
$$;

-- ---------------------------------------------------------------------------
-- 3. set_partner_sharing(p_invite_id, p_enabled) — owner pauses/resumes one
--    partner's access to shared entries
-- ---------------------------------------------------------------------------
-- Regression notes: before this, the only per-partner control was full
-- revoke. Pausing keeps the link (and its named invite row) while making
-- get_shared_events() return nothing for that partner — the approved
-- "Paused — sees nothing for now" state. Machine-readable errors:
--   not_authenticated — no caller identity
--   no_partner_link   — no such active (non-revoked) invite owned by caller

CREATE OR REPLACE FUNCTION set_partner_sharing(p_invite_id UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  UPDATE partner_invites
  SET sharing_enabled = p_enabled
  WHERE id = p_invite_id
    AND owner_user_id = auth.uid()
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_partner_link' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION set_partner_sharing(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_partner_sharing(UUID, BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. events.shared — generated column, can never drift from visibility
-- ---------------------------------------------------------------------------
-- Rationale: the client marks new entries shared/private via the existing
-- `visibility` column only. Deriving `shared` as a GENERATED column keeps
-- every reader (get_shared_events, the app, future queries) on one source
-- of truth — no trigger, no backfill drift, no double-write bug class.
-- Guarded: only added when public.events exists and the column is missing.

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'events'
         AND column_name = 'shared'
     ) THEN
    ALTER TABLE public.events
      ADD COLUMN shared BOOLEAN
        GENERATED ALWAYS AS (visibility IN ('shared', 'export')) STORED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. set_event_shared(p_event_id, p_shared) — owner flips one entry
-- ---------------------------------------------------------------------------
-- Regression notes: previously the only per-entry sharing control was the
-- raw `visibility` write path; this is the approved RPC for the entry-level
-- shared toggle. Turning sharing ON preserves 'export' (falls back to
-- 'shared' otherwise); turning it OFF always writes 'private'.
-- Machine-readable errors:
--   not_authenticated — no caller identity
--   not_found         — no such live (non-deleted) event owned by caller

CREATE OR REPLACE FUNCTION set_event_shared(p_event_id UUID, p_shared BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  UPDATE events
  SET visibility = CASE
                     WHEN p_shared THEN
                       CASE WHEN visibility = 'export' THEN 'export' ELSE 'shared' END
                     ELSE 'private'
                   END
  WHERE id = p_event_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION set_event_shared(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_event_shared(UUID, BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. user_share_settings — per-user default for new entries
-- ---------------------------------------------------------------------------
-- Approved design: per-entry sharing is ON by default; the client reads the
-- default via get_share_default() when composing a new entry. The setting
-- itself stays changeable via set_share_default(). RLS enabled, no
-- direct-access policies: anon/authenticated reach this table only through
-- the SECURITY DEFINER RPCs below (same pattern as partner_invites writes).

CREATE TABLE IF NOT EXISTS user_share_settings (
  user_id                 UUID PRIMARY KEY,
  share_new_entries_default BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_share_settings ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE user_share_settings ADD COLUMN IF NOT EXISTS share_new_entries_default BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE user_share_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_share_settings'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE user_share_settings ADD PRIMARY KEY (user_id);
  END IF;
END $$;

ALTER TABLE user_share_settings ENABLE ROW LEVEL SECURITY;

-- Defensive: no direct-access policies may exist on this table. Drop any
-- that do (e.g. left by a partial earlier apply) so RPC-only access holds.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_share_settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_share_settings', pol.policyname);
  END LOOP;
END $$;

-- Regression notes: get_share_default() answers "should the new-entry
-- composer default to shared?" — TRUE for fresh users (no row yet) and for
-- unauthenticated callers, so the client always has a safe default.

CREATE OR REPLACE FUNCTION get_share_default()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT share_new_entries_default
     FROM user_share_settings
     WHERE user_id = auth.uid()),
    TRUE
  );
$$;

-- Regression notes: set_share_default() upserts the caller's row; a missing
-- row and an existing row behave identically for the client. Raises
-- 'not_authenticated' with no identity so anonymous writes can't land.

CREATE OR REPLACE FUNCTION set_share_default(p_default BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO user_share_settings (user_id, share_new_entries_default, updated_at)
  VALUES (caller, p_default, now())
  ON CONFLICT (user_id) DO UPDATE
    SET share_new_entries_default = EXCLUDED.share_new_entries_default,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION get_share_default() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_share_default(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_share_default() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_share_default(BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. get_shared_events() — replaced: enforce per-partner toggle + per-entry
--    shared flag
-- ---------------------------------------------------------------------------
-- Regression notes / what changed vs 20260921120000:
--   - The linked invite must have sharing_enabled IS TRUE. When the owner
--     pauses a partner (set_partner_sharing(..., false)), that partner's
--     reads return nothing even though the link is not revoked.
--   - The event must have e.shared IS TRUE (the generated column from §4).
--     The visibility IN ('shared','export') filter is kept as well, so the
--     predicate reads the same on tables with or without the generated
--     column populated.
--   - Revoked links still see nothing (revoked_at IS NULL kept).
-- CREATE OR REPLACE preserves the existing REVOKE/GRANT from the earlier
-- migration, so no privilege statements are repeated here.

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
        AND sharing_enabled IS TRUE
      ORDER BY redeemed_at DESC
      LIMIT 1
    )
    AND e.visibility IN ('shared', 'export')
    AND e.shared IS TRUE
    AND e.deleted_at IS NULL
  ORDER BY e.occurred_at DESC;
$$;

-- Re-grant the rebuilt my_partner_invites() (its old ACLs died with the DROP).
REVOKE ALL ON FUNCTION my_partner_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_partner_invites() TO anon, authenticated;
