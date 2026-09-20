/**
 * Partner invite flow (Epic 7).
 *
 * A single-use invite link with a 24-hour expiry. Accepting the link is
 * NOT enough — the owner must confirm the partner account before a single
 * entry becomes visible (no auto-link by email alone). The actual send is
 * a system share-sheet handoff from the UI; this module owns generation,
 * expiry, single-use semantics, and owner confirmation.
 *
 * Stop flag (contract C3): no new invites while tracking is stopped.
 */

import {
  PARTNER_PLACEHOLDER_NAME,
  defaultStore,
  getPartnerLink,
  partnerSyncAllowed,
  recordPartnerHistory,
  setPartnerLink,
  type KvStore,
  type PartnerLink,
} from './model';

export type { KvStore };

/** Invite links live for 24 hours, then die. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export const INVITE_JOIN_HOST = 'nurture.app';

/** Local kv key for the one outstanding invite. */
export const PENDING_INVITE_KEY = 'partner:invite';

export interface PartnerInvite {
  id: string;
  /** Short code, e.g. "8f3k-29dx-qw" (single-use). */
  code: string;
  /** Full join URL handed to the share sheet. */
  url: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  usedAt: string | null; // ISO 8601 once claimed
  cancelledAt: string | null; // ISO 8601 once cancelled
}

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** "8f3k-29dx-qw" shaped code. `rng` is injectable for deterministic tests. */
export function makeInviteCode(rng: () => number = Math.random): string {
  const pick = () =>
    CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)] ?? 'a';
  const group = (n: number) => Array.from({ length: n }, pick).join('');
  return `${group(4)}-${group(4)}-${group(2)}`;
}

export function inviteJoinUrl(code: string): string {
  return `https://${INVITE_JOIN_HOST}/join/${code}`;
}

function inviteId(rng: () => number = Math.random): string {
  return `inv-${Math.floor(rng() * 1e12).toString(36)}-${Date.now().toString(36)}`;
}

/**
 * Creates a fresh single-use invite. Throws when partner sync is not
 * allowed (tracking stopped — contract C3).
 */
export function createInvite(
  store: KvStore = defaultStore(),
  now: Date = new Date(),
  rng: () => number = Math.random,
  readPregnancyStatus?: () => string | null,
): PartnerInvite {
  if (!partnerSyncAllowed(store, readPregnancyStatus)) {
    throw new InviteError('Partner sharing is paused — tracking has stopped.');
  }
  const code = makeInviteCode(rng);
  const createdAt = now.toISOString();
  const invite: PartnerInvite = {
    id: inviteId(rng),
    code,
    url: inviteJoinUrl(code),
    createdAt,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    usedAt: null,
    cancelledAt: null,
  };
  store.set(PENDING_INVITE_KEY, JSON.stringify(invite));
  setPartnerLink({ status: 'invited', partnerName: PARTNER_PLACEHOLDER_NAME }, store);
  recordPartnerHistory('invite_sent', 'Invite sent to your partner', store, now);
  return invite;
}

/** The outstanding invite, or null. Corrupt records read as none. */
export function getPendingInvite(store: KvStore = defaultStore()): PartnerInvite | null {
  try {
    const raw = store.get(PENDING_INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PartnerInvite;
    if (typeof parsed.code !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True once the 24-hour window has passed. */
export function isInviteExpired(invite: PartnerInvite, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(invite.expiresAt).getTime();
}

/** Usable = not expired, not claimed, not cancelled. */
export function isInviteUsable(invite: PartnerInvite, now: Date = new Date()): boolean {
  return !isInviteExpired(invite, now) && invite.usedAt === null && invite.cancelledAt === null;
}

/**
 * Marks the invite claimed (single-use). Throws when the invite is
 * expired, already used, or cancelled — the link dies either way.
 */
export function claimInvite(
  invite: PartnerInvite,
  store: KvStore = defaultStore(),
  now: Date = new Date(),
): PartnerInvite {
  if (invite.cancelledAt !== null) throw new InviteError('This invite was cancelled.');
  if (invite.usedAt !== null) throw new InviteError('This invite was already used.');
  if (isInviteExpired(invite, now)) throw new InviteError('This invite has expired.');
  const claimed: PartnerInvite = { ...invite, usedAt: now.toISOString() };
  store.set(PENDING_INVITE_KEY, JSON.stringify(claimed));
  return claimed;
}

/**
 * Cancels the outstanding invite. The link is dead from this point on and
 * the partner link returns to "not connected" (nothing was ever shared).
 */
export function cancelInvite(
  store: KvStore = defaultStore(),
  now: Date = new Date(),
): PartnerLink {
  const pending = getPendingInvite(store);
  if (pending && pending.cancelledAt === null && pending.usedAt === null) {
    store.set(
      PENDING_INVITE_KEY,
      JSON.stringify({ ...pending, cancelledAt: now.toISOString() }),
    );
    recordPartnerHistory('invite_cancelled', 'Invite cancelled', store, now);
  }
  const link: PartnerLink = { status: 'none', partnerName: PARTNER_PLACEHOLDER_NAME };
  setPartnerLink(link, store);
  return link;
}

/**
 * Owner confirmation gate: the partner account is confirmed before
 * access begins. Only a usable (claimed-or-fresh) invite can be
 * confirmed; on confirm the partner becomes 'active' and the one-time
 * link is retired. Throws when there is nothing confirmable.
 */
export function confirmPartner(
  store: KvStore = defaultStore(),
  now: Date = new Date(),
  readPregnancyStatus?: () => string | null,
): PartnerLink {
  if (!partnerSyncAllowed(store, readPregnancyStatus)) {
    throw new InviteError('Partner sharing is paused — tracking has stopped.');
  }
  const pending = getPendingInvite(store);
  if (!pending) throw new InviteError('There is no invite to confirm.');
  if (pending.cancelledAt !== null) throw new InviteError('This invite was cancelled.');
  if (isInviteExpired(pending, now)) throw new InviteError('This invite has expired.');
  const retired: PartnerInvite = {
    ...pending,
    usedAt: pending.usedAt ?? now.toISOString(),
    cancelledAt: now.toISOString(),
  };
  store.set(PENDING_INVITE_KEY, JSON.stringify(retired));
  const link: PartnerLink = { status: 'active', partnerName: PARTNER_PLACEHOLDER_NAME };
  setPartnerLink(link, store);
  recordPartnerHistory('partner_confirmed', 'Partner connected', store, now);
  return link;
}

/** Throws unless the link is currently in the invited state. */
export function requireInvitedLink(store: KvStore = defaultStore()): PartnerLink {
  const link = getPartnerLink(store);
  if (link.status !== 'invited') {
    throw new InviteError('No invite is waiting right now.');
  }
  return link;
}

