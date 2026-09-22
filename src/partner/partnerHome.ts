/**
 * Partner home — pure logic (mockup 34, Anuraj approved Sept 2026).
 *
 * The partner's home feed: her shared entries, newest first, with her
 * Logs day-grouping. This module is pure (no database, no expo, no
 * react-native imports) and unit-testable in plain node. It covers:
 *
 *   - mapping get_shared_events() rows to renderable shared entries
 *   - the at-a-glance strip (mood line / next-up / activity highlight),
 *     derived STRICTLY from currently-visible entries
 *   - contraction-timing wave geometry + the one calm summary line
 *   - loved-by label copy ("Loved by Sam" / "Loved by Sam and Noor")
 *   - the RPC wrappers (toggle_entry_love, get_my_loves, get_entry_loves)
 *     with the same graceful-degradation convention as inviteCodes.ts
 */

import type { PartnerRpc } from './inviteCodes';
import { classifyRpcError } from './inviteCodes';

/* ------------------------------------------------------------------ */
/* Shared entry — the partner's view of one of her entries             */
/* ------------------------------------------------------------------ */

/** One shared entry as the partner home renders it. */
export interface PartnerSharedEvent {
  id: string;
  /** EventType string ('note' | 'kick_session' | 'appointment' | 'activity' | 'report' | ...). */
  type: string;
  /** ISO 8601 — drives day-group placement and "tonight"/"last night". */
  occurredAt: string;
  /** The event payload (text, mood, kick counts, appointment fields, ...). */
  data: Record<string, unknown>;
  /** This partner's loved state (from get_my_loves, intersected at render). */
  lovedByMe: boolean;
}

/**
 * Maps one get_shared_events() row to a PartnerSharedEvent. Forgiving:
 * malformed rows return null (skipped), never throw. `data` may arrive
 * as an object (jsonb) or a JSON string.
 */
export function mapSharedEventRow(row: unknown): PartnerSharedEvent | null {
  try {
    if (row === null || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : null;
    const type = typeof r.type === 'string' && r.type.length > 0 ? r.type : null;
    const occurredAt =
      typeof r.occurred_at === 'string' && r.occurred_at.length > 0
        ? r.occurred_at
        : typeof r.occurredAt === 'string' && r.occurredAt.length > 0
          ? (r.occurredAt as string)
          : null;
    if (!id || !type || !occurredAt) return null;
    let data: Record<string, unknown> = {};
    if (r.data && typeof r.data === 'object') {
      data = r.data as Record<string, unknown>;
    } else if (typeof r.data === 'string' && r.data.length > 0) {
      try {
        const parsed: unknown = JSON.parse(r.data);
        if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
      } catch {
        /* keep {} */
      }
    }
    return { id, type, occurredAt, data, lovedByMe: false };
  } catch {
    return null;
  }
}

/** Newest-first by occurredAt. */
export function sortSharedNewest(events: PartnerSharedEvent[]): PartnerSharedEvent[] {
  return [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

/* ------------------------------------------------------------------ */
/* At a glance — feeling-first, derived ONLY from visible entries       */
/* ------------------------------------------------------------------ */

/** The three quiet lines of the at-a-glance strip. */
export interface AtAGlance {
  /** "She's feeling heavy but happy tonight." (or the quiet-day fallback) */
  moodLine: string;
  /** "Next up: OB visit, Friday at 2 PM" (or the no-calendar fallback) */
  nextUpLine: string;
  /** "10 little kicks tonight" — null when no shared kick session. */
  highlightLine: string | null;
}

function cleanText(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function cleanCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const f = Math.floor(n);
  return f >= 0 ? f : null;
}

function localDayISO(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(dayISO: string, delta: number): string {
  const [y, m, d] = dayISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function weekdayName(dayISO: string): string {
  const [y, m, d] = dayISO.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
}

/** "tonight" / "last night" / "on Friday" — the glance's day word. */
export function glanceDayWord(dayISO: string, todayISO: string): string {
  if (dayISO === todayISO) return 'tonight';
  if (dayISO === addDaysISO(todayISO, -1)) return 'last night';
  return `on ${weekdayName(dayISO)}`;
}

/**
 * Builds the at-a-glance strip from the CURRENTLY VISIBLE entries only.
 * Callers re-run this whenever the visible set changes (unshare, delete,
 * pause) — the strip always reflects her current choices.
 */
export function buildAtAGlance(
  events: PartnerSharedEvent[],
  ownerName: string,
  now: Date = new Date(),
): AtAGlance {
  const today = localDayISO(now.toISOString()) ?? '';
  const name = ownerName.trim() || 'your partner';

  // Mood: the newest shared log entry carrying a mood.
  let moodLine = `A quiet day in ${name}'s world.`;
  const moodEntry = events.find(
    (e) => (e.type === 'note' || e.type === 'mood') && cleanText(e.data.mood),
  );
  if (moodEntry) {
    const mood = cleanText(moodEntry.data.mood) ?? '';
    const day = localDayISO(moodEntry.occurredAt) ?? today;
    moodLine = `She's feeling ${mood} ${glanceDayWord(day, today)}.`;
    // Mockup 34's "tender" line ("A slower evening — worth an extra bit of
    // love."): real moods Rough/Tired are the hard-day moods.
    const low = mood.toLowerCase();
    if (low === 'rough' || low === 'tired' || low.includes('tender') || low.includes('heavy')) {
      moodLine += ' A slower evening — worth an extra bit of love.';
    }
  }

  // Next up: the nearest upcoming shared appointment (occurredAt in the
  // future), else the "nothing on the calendar" fallback.
  const nowMs = now.getTime();
  const upcoming = events
    .filter((e) => e.type === 'appointment' && Date.parse(e.occurredAt) > nowMs)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))[0];
  let nextUpLine = 'Nothing on the calendar — just the everyday';
  if (upcoming) {
    const title = cleanText(upcoming.data.title) ?? 'Appointment';
    const when = new Date(Date.parse(upcoming.occurredAt));
    const dayISO = localDayISO(upcoming.occurredAt) ?? '';
    const dayWord =
      dayISO === today
        ? 'today'
        : dayISO === addDaysISO(today, 1)
          ? 'tomorrow'
          : weekdayName(dayISO);
    const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    nextUpLine = `Next up: ${title}, ${dayWord} at ${time}`;
  }

  // Highlight: the newest shared kick session's movement count.
  let highlightLine: string | null = null;
  const kick = events.find((e) => e.type === 'kick_session');
  if (kick) {
    const movements = cleanCount(kick.data.movements) ?? cleanCount(kick.data.count);
    if (movements !== null) {
      const day = localDayISO(kick.occurredAt) ?? today;
      highlightLine = `${movements} little kicks ${glanceDayWord(day, today)}`;
    }
  }

  return { moodLine, nextUpLine, highlightLine };
}

/* ------------------------------------------------------------------ */
/* Contraction wave — gentle, visual, never clinical                    */
/* ------------------------------------------------------------------ */

/** One bump on the wave: a time label and a relative height 0…1. */
export interface WaveBump {
  /** "6:20 PM" — label beneath the bump. */
  label: string;
  /** 0…1 — height proportional to the session's contraction count. */
  height: number;
}

/**
 * Lays out the wave for one contraction-timing visit. The stored data is
 * aggregate-only (count, spanSec, avgIntervalSec — no per-contraction
 * times), so bumps are evenly spaced across the session span, each
 * standing for one contraction; the span's start/end carry time labels.
 * `occurredAt` is when the visit ended.
 */
export function contractionWave(
  count: number,
  spanSec: number,
  occurredAt: string,
  maxBumps = 24,
): { bumps: WaveBump[]; startLabel: string; endLabel: string } | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const endMs = Date.parse(occurredAt);
  if (!Number.isFinite(endMs)) return null;
  const span = Math.max(60, Math.floor(spanSec) || 60);
  const startMs = endMs - span * 1000;
  const n = Math.min(Math.floor(count), maxBumps);
  const bumps: WaveBump[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? endMs : startMs + (span * 1000 * i) / (n - 1);
    bumps.push({
      label: new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      height: 1,
    });
  }
  const startLabel = new Date(startMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const endLabel = new Date(endMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { bumps, startLabel, endLabel };
}

/**
 * The ONE calm summary line under the wave (mockup 34, verbatim shape):
 * "12 contractions, most about 5 minutes apart." Never clinical, never
 * alarming — no red/amber/green, no triage words.
 */
export function contractionSummaryLine(count: number, avgIntervalSec: number | null): string {
  const c = Math.max(1, Math.floor(count));
  const noun = c === 1 ? 'contraction' : 'contractions';
  if (avgIntervalSec === null || !Number.isFinite(avgIntervalSec) || avgIntervalSec <= 0) {
    return `${c} ${noun} this time.`;
  }
  const mins = Math.max(1, Math.round(avgIntervalSec / 60));
  const apart = mins === 1 ? 'a minute' : `${mins} minutes`;
  return `${c} ${noun}, most about ${apart} apart.`;
}

/* ------------------------------------------------------------------ */
/* Loved-by copy                                                        */
/* ------------------------------------------------------------------ */

/**
 * "Loved by Sam" / "Loved by Sam and Noor" / "Loved by Sam, Noor and one
 * other". The names are named-invite names (get_entry_loves), never ids.
 */
export function lovedByLabel(names: readonly string[]): string {
  const clean = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (clean.length === 0) return '';
  if (clean.length === 1) return `Loved by ${clean[0]}`;
  if (clean.length === 2) return `Loved by ${clean[0]} and ${clean[1]}`;
  return `Loved by ${clean[0]}, ${clean[1]} and ${clean.length - 2 === 1 ? 'one other' : `${clean.length - 2} others`}`;
}

/** The partner's own heart label: "Loved by Sam". */
export function myLoveLabel(myName: string): string {
  const name = myName.trim();
  return name.length > 0 ? `Loved by ${name}` : 'Loved';
}

/* ------------------------------------------------------------------ */
/* RPC wrappers — same graceful-degradation convention as inviteCodes    */
/* ------------------------------------------------------------------ */

export type ToggleLoveResult =
  | { status: 'ok'; loved: boolean }
  | { status: 'not_linked' | 'not_visible' | 'not_configured' | 'not_ready' | 'network' | 'unknown' };

/**
 * Toggles this partner's love on one entry. The server enforces the
 * sharing gates (active link, sharing on, entry currently visible):
 * 'not_linked' when the link is gone/paused, 'not_visible' when the
 * entry isn't visible to this partner. Never throws.
 */
export async function toggleEntryLove(
  entryId: string,
  rpc?: PartnerRpc | null,
): Promise<ToggleLoveResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('toggle_entry_love', { p_entry_id: entryId });
    if (error) {
      const msg = error.message ?? '';
      if (/not_linked/i.test(msg)) return { status: 'not_linked' };
      if (/not_visible/i.test(msg)) return { status: 'not_visible' };
      return { status: classifyRpcError(error) } as ToggleLoveResult;
    }
    return { status: 'ok', loved: data === true };
  } catch (e) {
    return { status: classifyRpcError(e) } as ToggleLoveResult;
  }
}

export type MyLovesResult =
  | { status: 'ok'; entryIds: string[] }
  | { status: 'not_configured' | 'not_ready' | 'network' | 'unknown' };

/** Entry ids this partner currently loves. The home intersects these with the visible entries. Never throws. */
export async function getMyLoves(rpc?: PartnerRpc | null): Promise<MyLovesResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('get_my_loves');
    if (error) return { status: classifyRpcError(error) } as MyLovesResult;
    const ids = Array.isArray(data)
      ? data.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    return { status: 'ok', entryIds: ids };
  } catch (e) {
    return { status: classifyRpcError(e) } as MyLovesResult;
  }
}

/** Her side: entry id -> loved-by partner names. Owner-only. Never throws. */
export async function getEntryLoves(
  eventIds: string[],
  rpc?: PartnerRpc | null,
): Promise<Record<string, string[]>> {
  if (!rpc || eventIds.length === 0) return {};
  try {
    const { data, error } = await rpc.rpc('get_entry_loves', { p_event_ids: eventIds });
    if (error) return {};
    const rows = Array.isArray(data) ? data : [];
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      if (r === null || typeof r !== 'object') continue;
      const rec = r as { entry_id?: unknown; partner_name?: unknown };
      const id = typeof rec.entry_id === 'string' ? rec.entry_id : null;
      const name = typeof rec.partner_name === 'string' ? rec.partner_name.trim() : '';
      if (!id || !name) continue;
      (out[id] ??= []).push(name);
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Partner's own link status — distinguishes empty vs paused            */
/* ------------------------------------------------------------------ */

export type PartnerLinkStatus =
  | { status: 'ok'; ownerId: string | null; sharingEnabled: boolean }
  | { status: 'not_configured' | 'not_ready' | 'network' | 'unknown' };

/**
 * The partner's own link row: which owner they're linked to and whether
 * sharing is on for them. The home uses sharingEnabled to distinguish
 * "Nothing shared yet" from the paused empty state. Never throws.
 */
export async function getPartnerLinkStatus(
  rpc?: PartnerRpc | null,
): Promise<PartnerLinkStatus> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('my_partner_link_status');
    if (error) return { status: classifyRpcError(error) } as PartnerLinkStatus;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return { status: 'ok', ownerId: null, sharingEnabled: false };
    }
    const rec = row as { owner_id?: unknown; sharing_enabled?: unknown };
    const ownerId = typeof rec.owner_id === 'string' && rec.owner_id.length > 0 ? rec.owner_id : null;
    const sharingEnabled = rec.sharing_enabled === true;
    return { status: 'ok', ownerId, sharingEnabled };
  } catch (e) {
    return { status: classifyRpcError(e) } as PartnerLinkStatus;
  }
}

/* ------------------------------------------------------------------ */
/* Shared events read path                                              */
/* ------------------------------------------------------------------ */

export type SharedEventsResult =
  | { status: 'ok'; events: PartnerSharedEvent[] }
  | { status: 'not_configured' | 'not_ready' | 'network' | 'unknown' };

/**
 * The partner's read path: her shared/export events, newest last here
 * (callers sort). Rows the server won't return (private, deleted,
 * unshared, paused partner) never reach this client. Never throws.
 */
export async function getSharedEvents(rpc?: PartnerRpc | null): Promise<SharedEventsResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('get_shared_events');
    if (error) return { status: classifyRpcError(error) } as SharedEventsResult;
    const rows = Array.isArray(data) ? data : [];
    const events: PartnerSharedEvent[] = [];
    for (const row of rows) {
      const mapped = mapSharedEventRow(row);
      if (mapped) events.push(mapped);
    }
    return { status: 'ok', events: sortSharedNewest(events) };
  } catch (e) {
    return { status: classifyRpcError(e) } as SharedEventsResult;
  }
}

/* ------------------------------------------------------------------ */
/* Partner-side identity (kv)                                           */
/* ------------------------------------------------------------------ */

/** This partner's own name (entered at redemption) — for "Loved by {name}". */
export const PARTNER_MY_NAME_KEY = 'partner.my_name';
/** Her name (from redeem_partner_invite) — for "{her name}'s journey". */
export const PARTNER_OWNER_NAME_KEY = 'partner.owner_name';

export interface PartnerKv {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Warm fallback when her name was never captured (older links). */
export const PARTNER_OWNER_NAME_FALLBACK = 'your partner';

export function getPartnerMyName(kv: PartnerKv): string | null {
  try {
    const v = kv.get(PARTNER_MY_NAME_KEY);
    return v && v.trim().length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}

export function getPartnerOwnerName(kv: PartnerKv): string {
  try {
    const v = kv.get(PARTNER_OWNER_NAME_KEY);
    return v && v.trim().length > 0 ? v.trim() : PARTNER_OWNER_NAME_FALLBACK;
  } catch {
    return PARTNER_OWNER_NAME_FALLBACK;
  }
}

export function setPartnerNames(kv: PartnerKv, myName: string, ownerName: string | null): void {
  try {
    if (myName.trim().length > 0) kv.set(PARTNER_MY_NAME_KEY, myName.trim());
    if (ownerName && ownerName.trim().length > 0) kv.set(PARTNER_OWNER_NAME_KEY, ownerName.trim());
  } catch {
    // Best-effort — the home works with fallbacks.
  }
}
