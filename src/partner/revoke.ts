/**
 * Partner revocation (Epic 7).
 *
 * One tap, immediate: the partner link goes to 'revoked', the
 * outstanding invite (if any) dies, and already-synced partner data is
 * marked for removal on the next sync (the partner may be offline when
 * revoked — contract C2). Revocation always applies locally, even when
 * tracking is stopped: taking access back must never be gated.
 *
 * Honest caveat, stated on-screen before she confirms: anything the
 * partner already saved or downloaded cannot be recalled.
 */

import {
  PARTNER_PENDING_REMOVAL_KEY,
  PARTNER_PLACEHOLDER_NAME,
  defaultStore,
  recordPartnerHistory,
  setPartnerLink,
  type KvStore,
  type PartnerLink,
} from './model';
import { PENDING_INVITE_KEY, getPendingInvite } from './invite';

/** On-screen warning shown before she confirms revocation. */
export const REVOKE_WARNING_COPY =
  'Heads up: anything Alex already saved or downloaded can\u2019t be taken back \u2014 revoking stops all future access.';

/** The revoke confirmation sheet copy. */
export function revokeConfirmCopy(partnerName: string = PARTNER_PLACEHOLDER_NAME): string {
  return (
    `This stops all future access \u2014 ${partnerName} won\u2019t see any of your moments ` +
    `from this point on (applies on their next sync if they\u2019re offline). ` +
    `Your story stays exactly as it is.`
  );
}

/**
 * Revokes partner access immediately. Returns the new link state.
 * Idempotent: revoking twice is a no-op the second time.
 */
export function revokePartner(
  store: KvStore = defaultStore(),
  now: Date = new Date(),
): PartnerLink {
  const link: PartnerLink = { status: 'revoked', partnerName: PARTNER_PLACEHOLDER_NAME };
  setPartnerLink(link, store);
  // Kill the outstanding invite so it can never be claimed afterwards.
  try {
    const pending = getPendingInvite(store);
    if (pending && pending.cancelledAt === null) {
      store.set(
        PENDING_INVITE_KEY,
        JSON.stringify({ ...pending, cancelledAt: now.toISOString() }),
      );
    }
  } catch {
    // The link state above is what matters; a stale invite record is harmless.
  }
  // Already-synced partner data is marked for removal on the next sync.
  try {
    store.set(PARTNER_PENDING_REMOVAL_KEY, now.toISOString());
  } catch {
    // Best-effort: the local revoke already landed.
  }
  recordPartnerHistory('revoked', 'Partner access revoked', store, now);
  return link;
}

/**
 * True while a revoke is waiting to be carried to the partner on the
 * next sync. The sync engine clears it via `clearPartnerRemovalFlag()`
 * once the removal has been pushed.
 */
export function partnerRemovalPending(store: KvStore = defaultStore()): boolean {
  try {
    return store.get(PARTNER_PENDING_REMOVAL_KEY) !== null;
  } catch {
    return false;
  }
}

/** Clears the pending-removal flag after the sync engine has pushed it. */
export function clearPartnerRemovalFlag(store: KvStore = defaultStore()): void {
  try {
    store.remove(PARTNER_PENDING_REMOVAL_KEY);
  } catch {
    // Best-effort.
  }
}
