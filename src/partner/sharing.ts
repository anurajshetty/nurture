/**
 * Per-entry partner sharing — shared logic (mockup 33 entry-sharing,
 * Anuraj approved Sept 21, 2026).
 *
 * The model: sharing is a handshake. Entries marked Shared are visible to
 * partners whose sharing is on. Three independent gates:
 *
 *   1. the partner link is live and the partner's per-link sharing switch
 *      is ON (see inviteCodes.ts — sharingEnabled)
 *   2. the entry is marked shared (visibility 'shared' | 'export')
 *   3. the global "Share new entries with partners" default (ON) decides
 *      the visibility of NEW entries only — changing it never touches
 *      existing entries
 *
 * Visibility stays the single stored value on LocalEvent ('private' |
 * 'shared' | 'export'); the server's events.shared boolean is generated
 * from it, so no drift is possible. This module is pure logic (no
 * database, no expo, no react-native imports) and is unit-testable in
 * plain node. The RPC client is injected as a fake.
 */

import type { LocalEvent, Visibility } from '../lib/types';
import type { PartnerRpc } from './inviteCodes';

/** Verbatim handshake explainer, shown everywhere sharing is explained. */
export const HANDSHAKE_COPY =
  'Sharing is a handshake: entries marked Shared are visible to partners whose sharing is on.';

/** Local kv key for the global per-user sharing default. */
export const SHARE_DEFAULT_KEY = 'partner.share_new_entries_default';

/** Minimal async key/value surface (AsyncStorage-compatible). */
export interface ShareKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * The global "Share new entries with partners" default. ON unless she
 * explicitly turned it OFF — new users share by default (approved
 * mockup: ON state is the resting state).
 */
export async function getShareNewEntriesDefault(kv: ShareKv): Promise<boolean> {
  try {
    const raw = await kv.getItem(SHARE_DEFAULT_KEY);
    if (raw === null || raw === undefined) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

/** Persist the global default; also mirrors it server-side best-effort. */
export async function setShareNewEntriesDefault(
  kv: ShareKv,
  value: boolean,
  rpc?: PartnerRpc | null,
): Promise<void> {
  try {
    await kv.setItem(SHARE_DEFAULT_KEY, value ? '1' : '0');
  } catch {
    /* local persistence is best-effort */
  }
  if (rpc) {
    try {
      await rpc.rpc('set_share_default', { p_default: value });
    } catch {
      /* server mirror is best-effort; local value stays authoritative */
    }
  }
}

/**
 * The visibility a NEW entry is created with: the global default, ON →
 * 'shared', OFF → 'private'. Auto-saved kicks and Activity events use
 * this too (no save-time UI).
 */
export async function newEntryVisibility(kv: ShareKv): Promise<Visibility> {
  return (await getShareNewEntriesDefault(kv)) ? 'shared' : 'private';
}

/** Whether a stored visibility value counts as shared with partners. */
export function isSharedVisibility(v: Visibility | null | undefined): boolean {
  return v === 'shared' || v === 'export';
}

/**
 * Event types that carry a real per-entry Shared toggle (mockup
 * 33-entry-sharing device C: log entries, kick sessions, appointments,
 * Activity cards, report summaries). Every other type keeps its existing
 * visibility-label rendering — no toggle.
 */
export const SHAREABLE_TOGGLE_TYPES: ReadonlySet<string> = new Set([
  'note',
  'kick_session',
  'appointment',
  'activity',
  'report',
]);

/** Whether a feed card for this event type shows the Shared toggle. */
export function canToggleSharing(type: LocalEvent['type'] | string): boolean {
  return SHAREABLE_TOGGLE_TYPES.has(type);
}

/**
 * Flip a shareable entry's visibility: private → shared, shared →
 * private. 'export' flips OFF to 'private' (re-sharing an export is the
 * export flow's own decision, not the card toggle's).
 */
export function toggleVisibility(v: Visibility): Visibility {
  return v === 'shared' || v === 'export' ? 'private' : 'shared';
}

/** Labels for the per-entry switch (mockup 33-entry-sharing, verbatim). */
export function shareToggleLabels(shared: boolean): { status: string; hint: string } {
  return shared
    ? { status: 'Shared', hint: 'Shared with your partner.' }
    : { status: 'Not shared', hint: 'Only you can see this.' };
}

/** Global-default row copy (mockup 33-entry-sharing device D, verbatim). */
export function shareDefaultSub(on: boolean): string {
  return on
    ? 'On — new logs, kicks, appointments and activities are shared.'
    : 'Off — new entries stay private unless you share them.';
}

export type ShareDefaultRemoteResult =
  | { status: 'ok'; value: boolean }
  | { status: 'not_ready' }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

/**
 * Read the server copy of the global default (used as a fallback when
 * the local kv has never been set on this device).
 */
export async function getShareDefaultRemote(
  rpc?: PartnerRpc | null,
): Promise<ShareDefaultRemoteResult> {
  if (!rpc) return { status: 'not_ready' };
  try {
    const { data, error } = await rpc.rpc('get_share_default');
    if (error) {
      const msg = error.message ?? '';
      if (/not configured|relation .* does not exist/i.test(msg)) {
        return { status: 'not_configured' };
      }
      return { status: 'error', message: msg };
    }
    return { status: 'ok', value: data === true };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export type SetEventSharedResult =
  | { status: 'ok' }
  | { status: 'not_ready' }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

/**
 * Owner-only server update of an entry's shared state (mirrors the local
 * visibility flip; the local SQLite row stays authoritative and the sync
 * outbox carries the change — this RPC is the direct server path).
 */
export async function setEventSharedRemote(
  eventId: string,
  shared: boolean,
  rpc?: PartnerRpc | null,
): Promise<SetEventSharedResult> {
  if (!rpc) return { status: 'not_ready' };
  try {
    const { error } = await rpc.rpc('set_event_shared', {
      p_event_id: eventId,
      p_shared: shared,
    });
    if (error) {
      const msg = error.message ?? '';
      if (/not configured|does not exist|function .* does not exist/i.test(msg)) {
        return { status: 'not_configured' };
      }
      return { status: 'error', message: msg };
    }
    return { status: 'ok' };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
