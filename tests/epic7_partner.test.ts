/**
 * Epic 7 tests: partner sharing — visibility defaults, invite expiry
 * (24h), single-use + owner-confirmation semantics, revoke semantics,
 * partner-limitation guards, and the stop flag (contract C3).
 *
 * Pure modules only (injectable KvStore); no native modules, no network.
 *
 * Run with:
 *   npx tsc tests/epic7_partner.test.ts src/partner/model.ts \
 *     src/partner/invite.ts src/partner/visibility.ts src/partner/revoke.ts \
 *     src/lib/types.ts \
 *     --outDir /tmp/nurture-epic7-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-epic7-tests/tests/epic7_partner.test.js
 */

import {
  PARTNER_PLACEHOLDER_NAME,
  canPartnerAddMemories,
  canPartnerChangeSettings,
  canPartnerExportRecord,
  canPartnerSeeEvent,
  defaultPartnerLink,
  getPartnerLink,
  isPartnerReactionAllowed,
  listPartnerHistory,
  PARTNER_LIMITATIONS_COPY,
  PARTNER_ALLOWED_REACTIONS,
  partnerSyncAllowed,
  recordPartnerHistory,
  setPartnerLink,
  type KvStore,
  type PartnerLink,
} from '../src/partner/model';
import {
  cancelInvite,
  claimInvite,
  confirmPartner,
  createInvite,
  getPendingInvite,
  INVITE_TTL_MS,
  isInviteExpired,
  isInviteUsable,
  inviteJoinUrl,
  makeInviteCode,
  requireInvitedLink,
} from '../src/partner/invite';
import {
  defaultVisibilityForType,
  isHealthLogType,
  setEntryVisibility,
  visibilityNote,
  VISIBILITY_OPTIONS,
} from '../src/partner/visibility';
import {
  clearPartnerRemovalFlag,
  partnerRemovalPending,
  revokeConfirmCopy,
  revokePartner,
  REVOKE_WARNING_COPY,
} from '../src/partner/revoke';
import type { EventType, Visibility } from '../src/lib/types';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function throws(fn: () => unknown, name: string): void {
  try {
    fn();
    failed++;
    console.error(`FAIL (no throw): ${name}`);
  } catch {
    passed++;
  }
}

/** In-memory KvStore stand-in; expo-sqlite is never touched. */
function fakeStore(): KvStore {
  const data = new Map<string, string>();
  return {
    get: (k) => (data.has(k) ? data.get(k)! : null),
    set: (k, v) => {
      data.set(k, v);
    },
    remove: (k) => {
      data.delete(k);
    },
  };
}

const T0 = new Date('2026-09-18T12:00:00.000Z');
const at = (msOffset: number) => new Date(T0.getTime() + msOffset);
const HOUR = 60 * 60 * 1000;

/* ---------------- visibility defaults by event type ---------------- */

const PRIVATE_TYPES: EventType[] = ['note', 'symptom', 'mood', 'weight', 'kick_session', 'appointment', 'question', 'file'];
for (const t of PRIVATE_TYPES) {
  ok(defaultVisibilityForType(t) === 'private', `default visibility private for ${t}`);
}
for (const t of ['milestone', 'photo'] as EventType[]) {
  ok(defaultVisibilityForType(t) === 'shared', `default visibility shared for ${t}`);
}
for (const t of ['symptom', 'mood', 'weight', 'kick_session'] as EventType[]) {
  ok(isHealthLogType(t), `${t} classified as health log`);
}
ok(!isHealthLogType('milestone'), 'milestone is not a health log');
ok(VISIBILITY_OPTIONS.length === 3, 'three visibility options');

// Plain-language notes name the partner and state the meaning.
const privNote = visibilityNote('private');
ok(privNote.includes('Private') && privNote.includes('Alex'), 'private note copy');
const sharedNote = visibilityNote('shared');
ok(sharedNote.includes('Shared') && sharedNote.includes('visit summaries'), 'shared note copy');
const exportNote = visibilityNote('export');
ok(exportNote.includes('visit summary'), 'export note copy');
ok(visibilityNote('shared', 'Sam').includes('Sam'), 'note uses the real partner name');

// Editable later: setEntryVisibility rewrites one row and marks it dirty.
{
  const calls: { sql: string; params: unknown[] }[] = [];
  setEntryVisibility('evt-1', 'shared', {
    runSync: (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
    },
  });
  ok(calls.length === 1, 'setEntryVisibility runs one update');
  ok(calls[0].sql.includes('SET visibility = ?'), 'update rewrites the visibility column');
  ok(calls[0].params[0] === 'shared', 'update writes the new visibility');
  ok(calls[0].params[2] === 'evt-1', 'update targets the right event');
  ok(calls[0].sql.includes('dirty = 1'), 'edited entry is marked dirty for sync');
}

/* ---------------- partner link model (contract C2) ---------------- */

{
  const store = fakeStore();
  const fresh = getPartnerLink(store);
  ok(fresh.status === 'none', 'fresh link reads as not connected');
  ok(fresh.partnerName === PARTNER_PLACEHOLDER_NAME, 'placeholder name is Alex');
  ok(PARTNER_PLACEHOLDER_NAME === 'Alex', 'v1 placeholder name is "Alex"');

  const link: PartnerLink = { status: 'active', partnerName: 'Alex' };
  setPartnerLink(link, store);
  const back = getPartnerLink(store);
  ok(back.status === 'active' && back.partnerName === 'Alex', 'link round-trips through the store');

  // Corrupt records never crash the reader.
  (store as { set(k: string, v: string): void }).set('partner:link', 'not-json{{{');
  const corrupt = getPartnerLink(store);
  ok(corrupt.status === 'none', 'corrupt link record reads as not connected');
  (store as { set(k: string, v: string): void }).set(
    'partner:link',
    JSON.stringify({ status: 'hacked', partnerName: 'Mallory' }),
  );
  ok(getPartnerLink(store).status === 'none', 'unknown status reads as not connected');
  ok(defaultPartnerLink().status === 'none', 'default link is not connected');
}

/* ---------------- invite: 24h expiry + single use ---------------- */

ok(INVITE_TTL_MS === 24 * 60 * 60 * 1000, 'invite TTL is exactly 24 hours');

{
  const rng = () => 0.5; // deterministic
  const code = makeInviteCode(rng);
  ok(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{2}$/.test(code), `invite code shape (${code})`);
  ok(inviteJoinUrl(code) === `https://nurture.app/join/${code}`, 'join URL shape');
}

{
  const store = fakeStore();
  const invite = createInvite(store, T0, () => 0.123456789);
  ok(
    new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime() === INVITE_TTL_MS,
    'invite expires exactly 24h after creation',
  );
  ok(!isInviteExpired(invite, T0), 'invite not expired at creation');
  ok(!isInviteExpired(invite, at(23 * HOUR + 59 * 60 * 1000)), 'invite not expired at 23h59m');
  ok(isInviteExpired(invite, at(24 * HOUR)), 'invite expired at exactly 24h');
  ok(isInviteUsable(invite, T0), 'fresh invite is usable');
  ok(!isInviteUsable(invite, at(25 * HOUR)), 'expired invite is not usable');

  // Link state follows invite creation.
  ok(getPartnerLink(store).status === 'invited', 'creating an invite sets status invited');

  // Single-use: claiming marks it; claiming again throws.
  const claimed = claimInvite(invite, store, at(HOUR));
  ok(claimed.usedAt !== null, 'claim stamps usedAt');
  ok(!isInviteUsable(getPendingInvite(store)!, at(2 * HOUR)), 'claimed invite is no longer usable');
  throws(() => claimInvite(getPendingInvite(store)!, store, at(2 * HOUR)), 'double claim throws');

  // Expiry kills the link even unclaimed.
  const store2 = fakeStore();
  const invite2 = createInvite(store2, T0, () => 0.987654321);
  throws(() => claimInvite(invite2, store2, at(25 * HOUR)), 'claim after expiry throws');

  // Cancel kills the link and resets the partner state.
  const store3 = fakeStore();
  createInvite(store3, T0, () => 0.5);
  const afterCancel = cancelInvite(store3, at(HOUR));
  ok(afterCancel.status === 'none', 'cancel returns link to not connected');
  const cancelled = getPendingInvite(store3)!;
  ok(cancelled.cancelledAt !== null, 'cancel stamps cancelledAt');
  throws(() => claimInvite(cancelled, store3, at(2 * HOUR)), 'claim after cancel throws');
  throws(() => requireInvitedLink(store3), 'no invited link remains after cancel');
}

/* ---------------- owner confirmation gate ---------------- */

{
  const store = fakeStore();
  throws(() => confirmPartner(store, T0), 'confirm with no invite throws');

  createInvite(store, T0, () => 0.25);
  const active = confirmPartner(store, at(2 * HOUR));
  ok(active.status === 'active', 'owner confirmation activates sharing');
  ok(active.partnerName === 'Alex', 'active link keeps the v1 placeholder name');
  const retired = getPendingInvite(store)!;
  ok(retired.cancelledAt !== null, 'the one-time link is retired on confirm');

  // Confirming again with nothing pending throws — no double-activation.
  throws(() => confirmPartner(store, at(3 * HOUR)), 'second confirm with no invite throws');
}

{
  // Expired invites cannot be confirmed.
  const store = fakeStore();
  createInvite(store, T0, () => 0.75);
  throws(() => confirmPartner(store, at(25 * HOUR)), 'confirm after expiry throws');
  ok(getPartnerLink(store).status === 'invited', 'failed confirm leaves state untouched');
}

/* ---------------- revoke semantics ---------------- */

{
  const store = fakeStore();
  createInvite(store, T0, () => 0.1);
  confirmPartner(store, at(HOUR));
  ok(getPartnerLink(store).status === 'active', 'precondition: active before revoke');

  const revoked = revokePartner(store, at(2 * HOUR));
  ok(revoked.status === 'revoked', 'revoke sets status revoked');
  ok(getPartnerLink(store).status === 'revoked', 'revoked link persists');
  ok(partnerRemovalPending(store), 'already-synced data is flagged for removal at next sync');
  const pending = getPendingInvite(store);
  ok(pending === null || pending.cancelledAt !== null, 'no live invite survives a revoke');

  // Idempotent.
  const again = revokePartner(store, at(3 * HOUR));
  ok(again.status === 'revoked', 'revoking twice stays revoked');

  // The sync engine clears the flag once it has pushed the removal.
  clearPartnerRemovalFlag(store);
  ok(!partnerRemovalPending(store), 'removal flag clears after sync');

  // The honest caveat is stated.
  ok(
    REVOKE_WARNING_COPY.includes('already saved or downloaded') &&
      REVOKE_WARNING_COPY.includes('can\u2019t be taken back'),
    'revoke warning names the downloaded-content caveat',
  );
  ok(
    revokeConfirmCopy('Alex').includes('next sync') && revokeConfirmCopy('Alex').includes('offline'),
    'revoke confirm names the offline-applies-at-next-sync behavior',
  );
}

/* ---------------- partner-limitation guards ---------------- */

{
  const active: PartnerLink = { status: 'active', partnerName: 'Alex' };
  const invited: PartnerLink = { status: 'invited', partnerName: 'Alex' };
  const none: PartnerLink = { status: 'none', partnerName: 'Alex' };
  const revoked: PartnerLink = { status: 'revoked', partnerName: 'Alex' };

  const vis: Visibility[] = ['private', 'shared', 'export'];
  for (const v of vis) {
    ok(!canPartnerSeeEvent(v, none), `partner sees nothing when not connected (${v})`);
    ok(!canPartnerSeeEvent(v, invited), `partner sees nothing while invite pending (${v})`);
    ok(!canPartnerSeeEvent(v, revoked), `partner sees nothing after revoke (${v})`);
  }
  ok(!canPartnerSeeEvent('private', active), 'private entries stay hidden when active');
  ok(canPartnerSeeEvent('shared', active), 'shared entries visible when active');
  ok(canPartnerSeeEvent('export', active), '+export entries visible when active');

  ok(canPartnerExportRecord() === false, 'partner can never export the record');
  ok(canPartnerChangeSettings() === false, 'partner can never change settings');
  ok(canPartnerAddMemories(active), 'partner can add notes/photos when active');
  ok(!canPartnerAddMemories(invited), 'partner cannot add memories before confirm');

  ok(PARTNER_ALLOWED_REACTIONS.length === 1, 'exactly one reaction exists');
  ok(isPartnerReactionAllowed('❤ Love'), '❤ Love is allowed');
  ok(!isPartnerReactionAllowed('👍'), 'thumbs-up is not an allowed reaction');
  ok(!isPartnerReactionAllowed('❤️'), 'variant hearts are not the allowed reaction');

  ok(
    PARTNER_LIMITATIONS_COPY.includes('private health logs') &&
      PARTNER_LIMITATIONS_COPY.includes('export') &&
      PARTNER_LIMITATIONS_COPY.includes('settings'),
    'limitations copy states all three restrictions',
  );
}

/* ---------------- access history ---------------- */

{
  const store = fakeStore();
  ok(listPartnerHistory(store).length === 0, 'history starts empty');
  recordPartnerHistory('invite_sent', 'Invite sent to your partner', store, T0);
  recordPartnerHistory('partner_confirmed', 'Alex connected', store, at(HOUR));
  const history = listPartnerHistory(store);
  ok(history.length === 2, 'history records real events');
  ok(history[0].kind === 'partner_confirmed', 'history is newest-first');
  ok(history[0].title === 'Alex connected', 'history keeps titles');

  // The invite flow records history automatically.
  const store2 = fakeStore();
  createInvite(store2, T0, () => 0.3);
  const kinds = listPartnerHistory(store2).map((h) => h.kind);
  ok(kinds.includes('invite_sent'), 'invite creation is recorded in history');
}

/* ---------------- stop flag: no partner sync when stopped (C3) ---------------- */

{
  const store = fakeStore();
  ok(partnerSyncAllowed(store, () => 'active'), 'sync allowed while active');
  ok(partnerSyncAllowed(store, () => null), 'sync allowed with no pregnancy record');
  ok(!partnerSyncAllowed(store, () => 'stopped'), 'no partner sync when stopped');

  throws(
    () => createInvite(store, T0, () => 0.4, () => 'stopped'),
    'invite creation is blocked while stopped',
  );
  throws(
    () => confirmPartner(fakeStore(), T0, () => 'stopped'),
    'owner confirmation is blocked while stopped',
  );
  ok(
    getPartnerLink(store).status === 'none',
    'blocked invite leaves partner state untouched',
  );

  // Revocation is never gated by the stop flag: taking access back always works.
  const store3 = fakeStore();
  setPartnerLink({ status: 'active', partnerName: 'Alex' }, store3);
  const revoked = revokePartner(store3, T0);
  ok(revoked.status === 'revoked', 'revoke works even when stopped');
}

console.log(`\n=== epic7_partner: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
