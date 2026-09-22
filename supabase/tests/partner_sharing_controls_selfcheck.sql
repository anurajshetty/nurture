-- ============================================================================
-- SELF-CHECK ONLY — partner sharing controls (20260921220000)
-- ============================================================================
-- Paste this whole file into the Supabase SQL editor to exercise the new
-- contract end-to-end. It runs inside a single transaction and ROLLS BACK at
-- the end: it changes NOTHING in the database.
--
-- Requirements:
--   * Run as a privileged session (the SQL editor's default postgres role):
--     the script temporarily redefines auth.uid() so two fake users can be
--     simulated. The redefinition lives only inside this transaction and is
--     rolled back. NEVER run the auth.uid() stub outside this transaction.
--   * Migrations 20260921120000 (partner invites) and 20260921220000
--     (sharing controls) must already be applied.
--   * Assumes the events table's writable NOT NULL columns are
--     (id, user_id, visibility, occurred_at). If your events table has
--     additional NOT NULL columns without defaults, extend the INSERT below.
--
-- Flow: create invite as owner -> my_partner_invites shows code while pending
-- -> redeem as a second user -> code hidden, sharing_enabled true ->
-- set_partner_sharing(false) -> get_shared_events returns nothing ->
-- set true -> set_event_shared(false) hides the event -> set_share_default
-- round-trip -> revoke pending invite works -> unauthenticated calls fail.
-- ============================================================================

BEGIN;

-- Stub auth.uid() to a controllable session setting. Rolled back at the end.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('selfcheck.uid', true), '')::uuid $$;

DO $$
DECLARE
  owner_id    UUID := '11111111-1111-1111-1111-111111111111';
  partner_id  UUID := '22222222-2222-2222-2222-222222222222';
  event_id    UUID := '33333333-3333-3333-3333-333333333333';
  invite_id   UUID;
  invite_code TEXT;
  invite2_id  UUID;
  row_ct      INT;
  vis         TEXT;
BEGIN
  -- --- 1. owner creates a named invite -------------------------------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  SELECT c.code INTO invite_code FROM create_partner_invite('Test Partner') AS c;
  IF invite_code IS NULL OR length(invite_code) <> 6 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: expected a 6-char code, got %', invite_code;
  END IF;
  RAISE NOTICE 'ok: invite created, code=%', invite_code;

  -- --- 2. my_partner_invites shows the code while pending -------------------
  SELECT i.invite_id, i.code INTO invite_id, invite_code
  FROM my_partner_invites() AS i;
  IF invite_id IS NULL THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: my_partner_invites returned no row';
  END IF;
  IF invite_code IS NULL THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: pending invite code should be visible to owner';
  END IF;
  RAISE NOTICE 'ok: pending invite visible with code, id=%', invite_id;

  -- --- 3. partner redeems ----------------------------------------------------
  PERFORM set_config('selfcheck.uid', partner_id::text, false);
  IF redeem_partner_invite(invite_code, 'Test Partner') <> owner_id THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: redeem did not return the owner id';
  END IF;
  RAISE NOTICE 'ok: redeemed, owner id returned';

  -- --- 4. owner: code hidden once accepted, sharing_enabled true ------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  SELECT i.code INTO invite_code FROM my_partner_invites() AS i WHERE i.status = 'accepted';
  IF invite_code IS NOT NULL THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: accepted invite must not re-expose its code';
  END IF;
  SELECT count(*) INTO row_ct FROM my_partner_invites() AS i
  WHERE i.status = 'accepted' AND i.sharing_enabled IS TRUE;
  IF row_ct <> 1 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: expected sharing_enabled=true after redeem';
  END IF;
  RAISE NOTICE 'ok: code hidden after redeem, sharing_enabled=true';

  -- --- 5. owner logs a shared event; partner sees it -------------------------
  INSERT INTO events (id, user_id, visibility, occurred_at)
  VALUES (event_id, owner_id, 'shared', now());
  PERFORM set_config('selfcheck.uid', partner_id::text, false);
  SELECT count(*) INTO row_ct FROM get_shared_events() AS e WHERE e.id = event_id;
  IF row_ct <> 1 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: partner should see the shared event';
  END IF;
  RAISE NOTICE 'ok: partner sees the shared event';

  -- --- 6. owner pauses the partner; partner sees nothing ---------------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  PERFORM set_partner_sharing(invite_id, false);
  PERFORM set_config('selfcheck.uid', partner_id::text, false);
  SELECT count(*) INTO row_ct FROM get_shared_events();
  IF row_ct <> 0 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: paused partner must see no events';
  END IF;
  RAISE NOTICE 'ok: set_partner_sharing(false) hides all events for the partner';

  -- --- 7. owner resumes; partner sees the event again -------------------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  PERFORM set_partner_sharing(invite_id, true);
  PERFORM set_config('selfcheck.uid', partner_id::text, false);
  SELECT count(*) INTO row_ct FROM get_shared_events() AS e WHERE e.id = event_id;
  IF row_ct <> 1 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: resumed partner should see the event again';
  END IF;
  RAISE NOTICE 'ok: set_partner_sharing(true) restores access';

  -- --- 8. owner unshares the entry itself; partner sees nothing ----------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  PERFORM set_event_shared(event_id, false);
  SELECT visibility INTO vis FROM events WHERE id = event_id;
  IF vis <> 'private' THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: expected visibility=private, got %', vis;
  END IF;
  PERFORM set_config('selfcheck.uid', partner_id::text, false);
  SELECT count(*) INTO row_ct FROM get_shared_events();
  IF row_ct <> 0 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: unshared event must be hidden from partner';
  END IF;
  RAISE NOTICE 'ok: set_event_shared(false) hides the entry (visibility=private)';

  -- --- 9. share-default round-trip --------------------------------------------
  PERFORM set_config('selfcheck.uid', owner_id::text, false);
  IF get_share_default() IS NOT TRUE THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: fresh user default should be TRUE';
  END IF;
  PERFORM set_share_default(false);
  IF get_share_default() IS NOT FALSE THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: default should be FALSE after set_share_default(false)';
  END IF;
  PERFORM set_share_default(true);
  IF get_share_default() IS NOT TRUE THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: default should be TRUE after set_share_default(true)';
  END IF;
  RAISE NOTICE 'ok: get/set_share_default round-trip';

  -- --- 10. revoke a pending invite ----------------------------------------------
  -- (two statements: a single statement can't see the row its own sibling
  -- subquery just inserted — Postgres uses one snapshot per statement)
  SELECT c.code INTO invite_code FROM create_partner_invite('Second Partner') AS c;
  SELECT i.invite_id INTO invite2_id FROM my_partner_invites() AS i WHERE i.code = invite_code;
  IF invite2_id IS NULL THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: could not find the new pending invite';
  END IF;
  PERFORM revoke_partner(invite2_id);
  SELECT count(*) INTO row_ct FROM my_partner_invites() AS i WHERE i.invite_id = invite2_id;
  IF row_ct <> 0 THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: revoked pending invite must leave the list';
  END IF;
  BEGIN
    PERFORM revoke_partner(invite2_id);
    RAISE EXCEPTION 'SELFCHECK FAIL: double revoke should raise no_partner_link';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'no_partner_link' THEN
      RAISE EXCEPTION 'SELFCHECK FAIL: expected no_partner_link, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'ok: revoke pending invite works; double revoke raises no_partner_link';

  -- --- 11. unauthenticated callers ----------------------------------------------
  RESET selfcheck.uid;
  BEGIN
    PERFORM set_partner_sharing(invite_id, true);
    RAISE EXCEPTION 'SELFCHECK FAIL: unauthenticated set_partner_sharing should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'not_authenticated' THEN
      RAISE EXCEPTION 'SELFCHECK FAIL: expected not_authenticated, got %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM set_event_shared(event_id, true);
    RAISE EXCEPTION 'SELFCHECK FAIL: unauthenticated set_event_shared should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'not_authenticated' THEN
      RAISE EXCEPTION 'SELFCHECK FAIL: expected not_authenticated, got %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM set_share_default(true);
    RAISE EXCEPTION 'SELFCHECK FAIL: unauthenticated set_share_default should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'not_authenticated' THEN
      RAISE EXCEPTION 'SELFCHECK FAIL: expected not_authenticated, got %', SQLERRM;
    END IF;
  END;
  IF get_share_default() IS NOT TRUE THEN
    RAISE EXCEPTION 'SELFCHECK FAIL: unauthenticated get_share_default should be TRUE';
  END IF;
  RAISE NOTICE 'ok: unauthenticated callers get not_authenticated (default stays TRUE)';

  RAISE NOTICE 'SELFCHECK PASSED — all partner sharing controls behaved as specified';
END $$;

ROLLBACK;

-- End of self-check. The ROLLBACK above reverted everything, including the
-- auth.uid() stub. Nothing in the database was changed.
