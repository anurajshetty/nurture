-- ============================================================================
-- Migration: partner home reactions — "love" a shared moment
-- ============================================================================
-- Sept 2026 (mockup 34, Anuraj approved): the partner's home feed is
-- read-only except for ONE warm interaction — a heart per card. Tapping
-- the heart toggles a "love" reaction; tapping again removes it. Her side
-- shows "Loved by {partner name}" on entries partners loved.
--
-- REPO-ONLY. NOT applied to production — Anuraj applies
-- willow-partner-sharing-production.sql in the SQL editor when ready.
--
-- New surface:
--   entry_reactions            — one row per (entry, partner) love
--   toggle_entry_love(uuid)    — partner-only heart toggle, visibility-gated
--   get_my_loves()             — entry ids this partner currently loves
--   my_partner_link_status()   — partner's own link row (owner + sharing on?)
--   get_entry_loves(uuid[])    — owner-only loved-by names per entry
--   redeem_partner_invite      — also returns her name (owner_name)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. entry_reactions — one row per (entry, partner) love
-- ---------------------------------------------------------------------------
-- A love is a fact, not a vote: no counts, no pickers, no comments. One row
-- per (entry, partner); un-loving deletes the row.

CREATE TABLE IF NOT EXISTS entry_reactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  partner_user_id UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, partner_user_id)
);

CREATE INDEX IF NOT EXISTS entry_reactions_entry_idx   ON entry_reactions(entry_id);
CREATE INDEX IF NOT EXISTS entry_reactions_partner_idx ON entry_reactions(partner_user_id);

-- Same access pattern as partner_invites: no direct table access, only
-- SECURITY DEFINER functions mediate.
ALTER TABLE entry_reactions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. toggle_entry_love(p_entry_id) — partner-only heart toggle
-- ---------------------------------------------------------------------------
-- Returns TRUE when the entry is now loved, FALSE when the love was
-- removed. Enforces the same gates as reads: the caller's link is live
-- (revoked_at IS NULL), the per-link sharing switch is ON, and the entry
-- is currently visible to this partner (shared/export, shared flag true,
-- not deleted). Loving a non-visible entry fails as 'not_visible' —
-- partners can only love what they can see, so a love can never leak a
-- private moment. Machine-readable errors, same convention as the other
-- partner functions.

CREATE OR REPLACE FUNCTION toggle_entry_love(p_entry_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partner  UUID := auth.uid();
  owner_id UUID;
  reaction UUID;
BEGIN
  IF partner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- The live, sharing-enabled link for this partner — the same predicate
  -- get_shared_events() uses, so loves and reads can never disagree.
  SELECT owner_user_id INTO owner_id
  FROM partner_invites
  WHERE redeemed_by = partner
    AND revoked_at IS NULL
    AND sharing_enabled IS TRUE
  ORDER BY redeemed_at DESC
  LIMIT 1;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'not_linked' USING ERRCODE = 'P0001';
  END IF;

  -- The entry must be currently visible to this partner.
  PERFORM 1
  FROM events e
  WHERE e.id = p_entry_id
    AND e.user_id = owner_id
    AND e.visibility IN ('shared', 'export')
    AND e.shared IS TRUE
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_visible' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO reaction
  FROM entry_reactions
  WHERE entry_id = p_entry_id
    AND partner_user_id = partner;

  IF FOUND THEN
    DELETE FROM entry_reactions WHERE id = reaction;
    RETURN FALSE;
  END IF;

  INSERT INTO entry_reactions (entry_id, partner_user_id)
  VALUES (p_entry_id, partner)
  ON CONFLICT (entry_id, partner_user_id) DO NOTHING;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION toggle_entry_love(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_entry_love(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_my_loves() — entry ids this partner currently loves
-- ---------------------------------------------------------------------------
-- The partner home intersects these with the currently-visible entries,
-- so loves on entries she later unshared never render.

CREATE OR REPLACE FUNCTION get_my_loves()
RETURNS UUID[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(entry_id), '{}'::uuid[])
  FROM entry_reactions
  WHERE partner_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION get_my_loves() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_loves() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. my_partner_link_status() — the partner's own link row
-- ---------------------------------------------------------------------------
-- Partner-only: (owner_id, sharing_enabled) for this partner's active link.
-- The home uses sharing_enabled to distinguish its two empty states:
--   no shared rows + sharing on  -> "Nothing shared yet"
--   no shared rows + sharing off -> paused empty state ("Nothing is lost…")
--   no active link at all        -> zero rows (revoked)

CREATE OR REPLACE FUNCTION my_partner_link_status()
RETURNS TABLE (owner_id UUID, sharing_enabled BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.owner_user_id, pi.sharing_enabled
  FROM partner_invites pi
  WHERE pi.redeemed_by = auth.uid()
    AND pi.revoked_at IS NULL
  ORDER BY pi.redeemed_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION my_partner_link_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_partner_link_status() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_entry_loves(p_event_ids) — her side: loved-by names per entry
-- ---------------------------------------------------------------------------
-- Owner-only: one row per (entry, loving partner) for events the caller
-- owns. The client groups rows by entry_id and renders
-- "Loved by {name}" / "Loved by {name} and {name}". The name is the
-- named-invite name (partner_invites.partner_name), never a raw user id.

CREATE OR REPLACE FUNCTION get_entry_loves(p_event_ids UUID[])
RETURNS TABLE(entry_id UUID, partner_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT r.entry_id, i.partner_name
  FROM entry_reactions r
  JOIN events e ON e.id = r.entry_id
  JOIN partner_invites i
    ON i.redeemed_by = r.partner_user_id
   AND i.owner_user_id = auth.uid()
   AND i.revoked_at IS NULL
  WHERE e.user_id = auth.uid()
    AND r.entry_id = ANY(p_event_ids)
  ORDER BY r.created_at;
$$;

REVOKE ALL ON FUNCTION get_entry_loves(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_entry_loves(UUID[]) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. redeem_partner_invite — also return her name
-- ---------------------------------------------------------------------------
-- The partner home header reads "{her name}'s journey" and the footer
-- "Only {her name} can add or remove moments here" — the partner's device
-- never has her name otherwise. The name comes from the owner's
-- pregnancies record when that table/column exists; NULL when it doesn't
-- (the client falls back to a warm generic). Validation logic is
-- unchanged from 20260921120000 — only the return shape changes, so DROP
-- first (CREATE OR REPLACE cannot change a return type).

DROP FUNCTION IF EXISTS redeem_partner_invite(TEXT, TEXT);

CREATE FUNCTION redeem_partner_invite(p_code TEXT, p_name TEXT)
RETURNS TABLE(owner_id UUID, owner_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partner  UUID := auth.uid();
  invite   RECORD;
  her_name TEXT := NULL;
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

  -- Her name for the partner home header/footer. The pregnancies table
  -- lives in a different migration (20260919150000); tolerate its absence.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pregnancies'
      AND column_name = 'owner_name'
  ) THEN
    EXECUTE
      'SELECT owner_name FROM public.pregnancies WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1'
      INTO her_name
      USING invite.owner_user_id;
  END IF;

  RETURN QUERY SELECT invite.owner_user_id, her_name;
END;
$$;

REVOKE ALL ON FUNCTION redeem_partner_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_partner_invite(TEXT, TEXT) TO anon, authenticated;
