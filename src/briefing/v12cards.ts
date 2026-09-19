/**
 * v1.2 event-aware Home cards (Track 2): visit-prep + milestone-celebrated.
 *
 * Pure, on-device logic for the two cards in proposal §5 that need logged
 * events (Epics 4.5/4.7):
 *
 * - `timely-visit-prep`: fires when the nearest upcoming appointment is
 *   ≤3 days away. Body carries the question-inbox count (non-dismissed
 *   states only, via readQuestionsFromData).
 * - `timely-milestone-celebrated`: fires once per milestone event id while
 *   the milestone is recent (≤7 days). One-time persistence uses the kv
 *   pattern from ./cache.ts under `v12.celebrated.<eventId>`; the 7-day
 *   recency gate is the auto-expiry.
 *
 * The engine (./engine.ts) stays pure: every signal arrives via
 * EngineInput, assembled by the caller (see ./policy.ts + ./useBriefing.ts).
 * The `pregnancyActive` gate on EngineInput implements Epic 9 contract C3
 * the same way the appointment-reminder planner does — a boolean in the
 * pure input, and both cards are suppressed when it is false.
 *
 * Privacy: both cards render the mother's own words (appointment /
 * milestone titles she typed), so their slots are `phrase: false` — they
 * never join the phraser payload (proposal §1: no free text leaves the
 * device).
 *
 * Module scope is dependency-free (only the node-safe questions reader
 * plus a lazy `require` inside the one impure reader), so the whole pure
 * core unit-tests under plain node.
 */

import { readQuestionsFromData } from '../plan/questions';

declare const require: (id: string) => unknown;

/** Visit-prep fires when the appointment is this many days away (inclusive). */
export const VISIT_PREP_WINDOW_DAYS = 3;
/** A milestone counts as "recent" within this many days (inclusive). */
export const MILESTONE_RECENCY_DAYS = 7;
/** kv prefix marking a milestone as celebrated (one-time per event id). */
export const CELEBRATED_KEY_PREFIX = 'v12.celebrated.';

/** Minimal kv surface — the same shape as ./cache.ts KvStore. */
export interface V12Kv {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * Appointment candidate, as assembled from the local event store.
 * Shape contract (Track 1 builds the logging against this):
 * { type:'appointment', occurredAt:<ISO>, data:{ title, note?, questions? } }.
 */
export interface V12Appointment {
  id: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/**
 * Milestone candidate, as assembled from the local event store.
 * Shape contract: { type:'milestone', data:{ title, note? } }.
 */
export interface V12Milestone {
  id: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Date math (calendar days, TZ-independent)                            */
/* ------------------------------------------------------------------ */

/** "2026-09-19T10:00:00.000Z" → [2026, 9, 19]; null when unparseable. */
function dateParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** Calendar-day difference: later minus earlier. Null when unparseable. */
function daysBetween(earlierISO: string, laterISO: string): number | null {
  const a = dateParts(earlierISO);
  const b = dateParts(laterISO);
  if (!a || !b) return null;
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Math.round(ms / 86_400_000);
}

/**
 * True when occurredAt falls on today..today+windowDays (calendar days,
 * inclusive of the boundary). Pure.
 */
export function isWithinDaysAhead(
  occurredAt: string,
  todayISO: string,
  windowDays: number,
): boolean {
  const diff = daysBetween(todayISO, occurredAt);
  return diff !== null && diff >= 0 && diff <= windowDays;
}

/**
 * True when occurredAt falls within the last windowDays calendar days
 * (inclusive of the boundary). Pure.
 */
export function isWithinDaysAgo(
  occurredAt: string,
  todayISO: string,
  windowDays: number,
): boolean {
  const diff = daysBetween(occurredAt, todayISO);
  return diff !== null && diff >= 0 && diff <= windowDays;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Full weekday of the calendar date part ("Thursday"). TZ-independent. */
export function weekdayOf(iso: string): string | null {
  const p = dateParts(iso);
  if (!p) return null;
  return WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
}

/* ------------------------------------------------------------------ */
/* Copy (proposal §5, approved — do not rephrase)                       */
/* ------------------------------------------------------------------ */

/** Trims to a warm, row-safe title; falls back when she never named it. */
export function v12Title(data: Record<string, unknown>, fallback: string): string {
  const raw = data.title;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.length > 0) return t.length > 80 ? t.slice(0, 77).trimEnd() + '…' : t;
  }
  return fallback;
}

/**
 * Open question-inbox count: every non-'dismissed' question state counts
 * (to_ask, asked, answered, deferred). Never throws.
 */
export function openQuestionCount(data: Record<string, unknown>): number {
  try {
    return readQuestionsFromData(data).filter((q) => q.state !== 'dismissed')
      .length;
  } catch {
    return 0;
  }
}

/**
 * Approved v1.2 visit-prep line:
 * "{Title} {Weekday} · {N} questions waiting in your inbox. Anything else
 *  on your mind before you go?"
 * N=1 uses the singular; N=0 drops the count clause entirely.
 */
export function visitPrepLine(appt: V12Appointment): string {
  const title = v12Title(appt.data, 'Appointment');
  const weekday = weekdayOf(appt.occurredAt);
  const head = weekday ? `${title} ${weekday}` : title;
  const n = openQuestionCount(appt.data);
  if (n === 0) return `${head} · Anything on your mind before you go?`;
  const noun =
    n === 1
      ? '1 question waiting in your inbox'
      : `${n} questions waiting in your inbox`;
  return `${head} · ${noun}. Anything else on your mind before you go?`;
}

/** Approved v1.2 celebrated line: "{Title} — saved to your story ♥". */
export function celebratedLine(m: V12Milestone): string {
  return `${v12Title(m.data, 'Milestone')} — saved to your story ♥`;
}

/* ------------------------------------------------------------------ */
/* One-time persistence (kv pattern from ./cache.ts)                    */
/* ------------------------------------------------------------------ */

export function celebratedKey(eventId: string): string {
  return `${CELEBRATED_KEY_PREFIX}${eventId}`;
}

/** True when this milestone already had its one-time card. Never throws. */
export function isCelebrated(
  store: V12Kv | null | undefined,
  eventId: string,
): boolean {
  try {
    return !!store && store.get(celebratedKey(eventId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Marks the card shown the moment it fires — one-time per event id.
 * Best-effort; never throws.
 */
export function markCelebrated(
  store: V12Kv | null | undefined,
  eventId: string,
  todayISO: string,
): void {
  if (!store) return;
  try {
    store.set(celebratedKey(eventId), todayISO);
  } catch {
    // A lost mark just means the next refresh re-checks; harmless.
  }
}

/* ------------------------------------------------------------------ */
/* Impure reader (device only)                                          */
/* ------------------------------------------------------------------ */

/**
 * Latest non-deleted milestone event, any age — the engine applies the
 * 7-day recency gate, so the reader stays dumb. Lazy db require keeps
 * module scope node-safe. Never throws.
 */
export function readLatestMilestoneEvent(): V12Milestone | null {
  try {
    const db = require('../lib/db') as {
      getDb(): {
        getFirstSync<T>(sql: string, ...params: unknown[]): T | null;
      };
    };
    const row = db
      .getDb()
      .getFirstSync<{ id: string; occurred_at: string; data: string }>(
        `SELECT id, occurred_at, data FROM events
         WHERE type = 'milestone' AND deleted_at IS NULL
         ORDER BY occurred_at DESC LIMIT 1`,
      );
    if (!row || typeof row.id !== 'string' || typeof row.occurred_at !== 'string') {
      return null;
    }
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.data) as unknown;
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = {};
    }
    return { id: row.id, occurredAt: row.occurred_at, data };
  } catch {
    return null;
  }
}
