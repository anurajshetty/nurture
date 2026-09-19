/**
 * Partner sharing model (Epic 7, contract C2).
 *
 * The owner's link to their partner: not-connected, invited (pending owner
 * confirmation), active, or revoked. The partner's display name is the
 * v1 placeholder "Alex" (Anuraj-approved) until a real invite is accepted.
 *
 * Storage: the local key/value store, through an injectable `KvStore` so
 * this module stays importable in the node unit-test runner (expo-sqlite
 * is only touched through a lazy require, exactly like
 * src/briefing/cache.ts). The zero-arg `getPartnerLink()` is the contract
 * C2 entry point; Epic 9 reads it read-only.
 *
 * Stop flag (contract C3): `partnerSyncAllowed()` is false when
 * `pregnancy.status === 'stopped'` — no partner sync while stopped.
 * Revocation itself always applies locally, stopped or not.
 */

import type { Visibility } from '../lib/types';

declare const require: (id: string) => unknown;

export type PartnerStatus = 'none' | 'invited' | 'active' | 'revoked';

/** Contract C2: the partner link. */
export interface PartnerLink {
  status: PartnerStatus;
  /** Display name; the v1 placeholder "Alex" until a real invite is accepted. */
  partnerName: string;
}

/** v1 placeholder partner name (Anuraj-approved, Sept 2026). */
export const PARTNER_PLACEHOLDER_NAME = 'Alex';

/** Local kv keys owned by the partner module. */
export const PARTNER_LINK_KEY = 'partner:link';
export const PARTNER_HISTORY_KEY = 'partner:history';
/**
 * Set when a revoke happens: already-synced partner data must be marked
 * for removal on the next sync (the partner may be offline when revoked).
 */
export const PARTNER_PENDING_REMOVAL_KEY = 'partner:pendingRemoval';

/** Minimal key/value surface the partner state needs. */
export interface KvStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * The production store, resolved lazily so importing this module in a
 * node test runner never touches expo-sqlite. (Metro resolves
 * '../lib/db' to db.web.ts on web — same kvGet/kvSet/kvDelete API.)
 */
export function defaultStore(): KvStore {
  const db = require('../lib/db') as {
    kvGet(key: string): string | null;
    kvSet(key: string, value: string): void;
    kvDelete(key: string): void;
  };
  return {
    get: (key) => db.kvGet(key),
    set: (key, value) => db.kvSet(key, value),
    remove: (key) => db.kvDelete(key),
  };
}

/** The link state before anything has ever happened. */
export function defaultPartnerLink(): PartnerLink {
  return { status: 'none', partnerName: PARTNER_PLACEHOLDER_NAME };
}

function isPartnerStatus(value: unknown): value is PartnerStatus {
  return value === 'none' || value === 'invited' || value === 'active' || value === 'revoked';
}

/**
 * Contract C2: reads the current partner link. Never throws — a missing
 * or corrupt record reads as "not connected".
 */
export function getPartnerLink(store: KvStore = defaultStore()): PartnerLink {
  try {
    const raw = store.get(PARTNER_LINK_KEY);
    if (!raw) return defaultPartnerLink();
    const parsed = JSON.parse(raw) as { status?: unknown; partnerName?: unknown };
    if (!isPartnerStatus(parsed.status)) return defaultPartnerLink();
    const name =
      typeof parsed.partnerName === 'string' && parsed.partnerName.trim().length > 0
        ? parsed.partnerName
        : PARTNER_PLACEHOLDER_NAME;
    return { status: parsed.status, partnerName: name };
  } catch {
    return defaultPartnerLink();
  }
}

/** Persists the partner link (local only; sync picks it up via dirty flags). */
export function setPartnerLink(link: PartnerLink, store: KvStore = defaultStore()): void {
  store.set(PARTNER_LINK_KEY, JSON.stringify(link));
}

/**
 * Contract C3: partner sync is only allowed while tracking is active.
 * False when the pregnancy record is stopped (Epic 9 owns that
 * transition). Fail-open on read errors — a broken read must not lock
 * her out of local partner state. `readPregnancyStatus` is injectable
 * for unit tests; on-device it reads the real store.
 */
export function partnerSyncAllowed(
  store: KvStore = defaultStore(),
  readPregnancyStatus?: () => string | null,
): boolean {
  try {
    // The injected reader (unit tests) never touches the native store.
    if (readPregnancyStatus) return readPregnancyStatus() !== 'stopped';
    // getActivePregnancy() only returns active rows, so a stopped
    // pregnancy reads as null through it — listPregnancies() carries
    // the actual status (contract C3).
    const syncStore = require('../sync/store') as {
      listPregnancies(): { status: string }[];
    };
    const latest = syncStore.listPregnancies()[0];
    return (latest?.status ?? null) !== 'stopped';
  } catch {
    return true;
  }
  void store;
}

/* ------------------------------------------------------------------ */
/* Access history — a small local log of what happened, when.          */
/* ------------------------------------------------------------------ */

/** Kinds of access-history entries. Partner-side views/reactions land here once sync carries them. */
export type PartnerHistoryKind =
  | 'invite_sent'
  | 'invite_cancelled'
  | 'partner_confirmed'
  | 'revoked'
  | 'view'
  | 'reaction'
  | 'contribution';

export interface PartnerHistoryEntry {
  id: string;
  kind: PartnerHistoryKind;
  title: string;
  at: string; // ISO 8601
}

const HISTORY_LIMIT = 50;

let historySeq = 0;

/** Newest-first access history. Never throws. */
export function listPartnerHistory(store: KvStore = defaultStore()): PartnerHistoryEntry[] {
  try {
    const raw = store.get(PARTNER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PartnerHistoryEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { id?: unknown }).id === 'string' &&
        typeof (e as { title?: unknown }).title === 'string' &&
        typeof (e as { at?: unknown }).at === 'string',
    );
  } catch {
    return [];
  }
}

/** Appends an access-history entry (newest first, capped). Never throws. */
export function recordPartnerHistory(
  kind: PartnerHistoryKind,
  title: string,
  store: KvStore = defaultStore(),
  now: Date = new Date(),
): void {
  try {
    const entry: PartnerHistoryEntry = {
      id: `ph-${now.getTime()}-${historySeq++}`,
      kind,
      title,
      at: now.toISOString(),
    };
    const next = [entry, ...listPartnerHistory(store)].slice(0, HISTORY_LIMIT);
    store.set(PARTNER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // History is informational; it must never break the flow.
  }
}

/* ------------------------------------------------------------------ */
/* Partner limitations — stated on-screen per the approved mockup.     */
/* ------------------------------------------------------------------ */

/** On-screen limitations copy (mockup §"Partner cannot"). */
export const PARTNER_LIMITATIONS_COPY =
  'Alex can\u2019t see private health logs, export your record, or change your settings.';

/** The single reaction a partner may send on a shared entry. No others exist. */
export const PARTNER_ALLOWED_REACTIONS = ['❤ Love'] as const;

/** A partner sees exactly the shared entries — nothing private, nothing else. */
export function canPartnerSeeEvent(visibility: Visibility, link: PartnerLink): boolean {
  return link.status === 'active' && (visibility === 'shared' || visibility === 'export');
}

/** The partner can never export the full record. */
export function canPartnerExportRecord(): false {
  return false;
}

/** The partner can never change the due date or owner settings. */
export function canPartnerChangeSettings(): false {
  return false;
}

/** The partner may add notes and photos once connected. */
export function canPartnerAddMemories(link: PartnerLink): boolean {
  return link.status === 'active';
}

/** Only ❤ Love — no other reactions, no comments, no feed. */
export function isPartnerReactionAllowed(reaction: string): boolean {
  return (PARTNER_ALLOWED_REACTIONS as readonly string[]).includes(reaction);
}

/**
 * Human-friendly relative time for access-history rows
 * ("2 hours ago", "Yesterday", "Sep 12").
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return 'Just now';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
