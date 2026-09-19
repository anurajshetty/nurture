/**
 * Memory look-back selection (Epic 3.3): picks the "N weeks ago today" card.
 *
 * PURE module — no imports from '../lib/db', no expo imports. Safe to import
 * in node for unit tests (see tests/epic3_lookback.test.ts).
 *
 * Product rules: warmth is the product. Copy here is raw-memory only —
 * no diagnosis, triage, or medical interpretation anywhere in wording or logic.
 */

import type { LocalEvent } from '../lib/types';
import { addDaysISO, parseISODate, toISODate } from '../onboarding/dates';

/** How many weeks back the look-back card reaches. */
export const LOOK_BACK_WEEKS_AGO = 4;

/** Exact-day target for "N weeks ago today" closeness ranking. */
const TARGET_DAYS_AGO = LOOK_BACK_WEEKS_AGO * 7; // 28

/** Give-or-take window around the target: ±3 days. */
const WINDOW_SLACK_DAYS = 3;

/** Max quote length before truncation (~120 chars + ellipsis). */
const MAX_QUOTE_LENGTH = 120;

export interface LookBack {
  event: LocalEvent;
  weeksAgo: number;
  quote: string;
  subline: string;
}

/**
 * YYYY-MM-DD bounds for "4 weeks ago, give or take 3 days", as a half-open
 * range: start = 31 days before now's date, end = 25 days before (exclusive).
 * Events with occurredAt on or after start and before end qualify.
 */
export function lookBackWindow(now: Date): { startISO: string; endISO: string } {
  const nowISO = toISODate(now);
  // Pure calendar math via onboarding/date helpers (no timezone conversion:
  // a look-back is about the device's local day, not a UTC timestamp).
  const startISO = addDaysISO(nowISO, -(TARGET_DAYS_AGO + WINDOW_SLACK_DAYS));
  const endISO = addDaysISO(nowISO, -(TARGET_DAYS_AGO - WINDOW_SLACK_DAYS));
  if (!startISO || !endISO) {
    throw new Error('lookBackWindow: failed to compute date bounds');
  }
  return { startISO, endISO };
}

/** Calendar date portion (YYYY-MM-DD) of an event's occurredAt; null when invalid. */
function eventDayISO(event: LocalEvent): string | null {
  if (typeof event.occurredAt !== 'string') return null;
  const day = event.occurredAt.slice(0, 10);
  return parseISODate(day) ? day : null;
}

/** Defensive read of data.attachments (same contract as EventCard's parser). */
function photoAttachmentsOf(data: Record<string, unknown>): number {
  const raw = data.attachments;
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const kind = (a as Record<string, unknown>).kind;
    if (kind === 'photo') count += 1;
  }
  return count;
}

/** Raw user text on the event (never interpreted, just displayed). */
function eventText(event: LocalEvent): string {
  const d = event.data ?? {};
  if (typeof d.text === 'string') return d.text.trim();
  if (typeof d.note === 'string') return d.note.trim();
  return '';
}

/** True when the event is a photo moment (type 'photo' or carries a photo attachment). */
function isPhotoEvent(event: LocalEvent): boolean {
  if (event.type === 'photo') return true;
  return photoAttachmentsOf(event.data ?? {}) > 0;
}

const TYPE_LABELS: Record<string, string> = {
  note: 'Moment',
  mood: 'Mood',
  photo: 'Photo',
  milestone: 'Milestone',
  symptom: 'Symptoms',
  appointment: 'Appointment',
  kick_session: 'Kicks',
  report: 'Report',
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? 'Moment';
}

/** "Aug 20" — warm, short, no year. Falls back to the raw date string. */
function formatShortMD(dayISO: string): string {
  const d = parseISODate(dayISO);
  if (!d) return dayISO;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dayISO;
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_QUOTE_LENGTH) return text;
  return `${text.slice(0, MAX_QUOTE_LENGTH).trimEnd()}…`;
}

function buildLookBack(event: LocalEvent): LookBack {
  const text = eventText(event);
  const photo = isPhotoEvent(event);
  const quote = text ? truncate(text) : photo ? 'A photo from that day' : '';
  const day = eventDayISO(event);
  const subline = `${typeLabel(event.type)} · ${day ? formatShortMD(day) : 'that day'} · tap to revisit`;
  return { event, weeksAgo: LOOK_BACK_WEEKS_AGO, quote, subline };
}

/**
 * Whole days between eventDay and nowDay (nowDay - eventDay), both YYYY-MM-DD.
 */
function daysAgoISO(eventDay: string, nowDay: string): number {
  const e = parseISODate(eventDay);
  const n = parseISODate(nowDay);
  if (!e || !n) return Number.MAX_SAFE_INTEGER;
  return Math.round((n.getTime() - e.getTime()) / 86_400_000);
}

/**
 * From candidate events (already scoped to the look-back window by the caller,
 * or re-checked here), pick one memory to surface:
 *
 * 1. Prefer photo events (type 'photo' or any photo attachment) — a photo
 *    moment always qualifies, even with no text.
 * 2. Otherwise notes/moods/milestones (and other types) with non-empty text.
 * 3. Among the surviving group, pick the event whose occurredAt is closest to
 *    exactly 28 days ago. First-in on ties (stable, deterministic).
 *
 * Returns null when no candidate qualifies. Copy is warm and neutral — the
 * quote is her own raw text, never summarized or interpreted.
 */
export function chooseLookBack(candidates: LocalEvent[], now: Date): LookBack | null {
  const { startISO, endISO } = lookBackWindow(now);
  const nowISO = toISODate(now);

  const inWindow: { event: LocalEvent; day: string }[] = [];
  for (const event of candidates) {
    if (event.deletedAt) continue; // never surface a deleted memory
    const day = eventDayISO(event);
    if (!day) continue;
    if (day < startISO || day >= endISO) continue; // half-open window
    inWindow.push({ event, day });
  }
  if (inWindow.length === 0) return null;

  const photos = inWindow.filter(({ event }) => isPhotoEvent(event));
  const pool =
    photos.length > 0
      ? photos
      : inWindow.filter(({ event }) => eventText(event).length > 0);
  if (pool.length === 0) return null;

  let best = pool[0]!;
  let bestScore = Math.abs(daysAgoISO(pool[0]!.day, nowISO) - TARGET_DAYS_AGO);
  for (const cand of pool.slice(1)) {
    const score = Math.abs(daysAgoISO(cand.day, nowISO) - TARGET_DAYS_AGO);
    if (score < bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return buildLookBack(best.event);
}

/**
 * Stable per-calendar-week key for dismissal scoping, e.g. "2026-W38".
 *
 * Scheme: ISO 8601 week numbering computed on the device's local calendar
 * date — week 01 is the week containing the year's first Thursday, weeks run
 * Monday–Sunday, and the year is the ISO week-year (so e.g. Jan 1 2027 can
 * belong to "2026-W53" when it falls in 2026's last ISO week). A dismissal
 * recorded under this key applies to the whole calendar week the card
 * appeared in, then the card may surface again the following week.
 */
export function lookBackWeekKey(now: Date): string {
  // Work in local-calendar terms: strip to midnight, then shift to the
  // Thursday of this ISO week to find the ISO week-year.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - dow + 3);
  const isoYear = thursday.getFullYear();
  // Monday of ISO week 1 = Monday of the week containing Jan 4.
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Dow);
  const week = Math.round((thursday.getTime() - week1Monday.getTime()) / 86_400_000 / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
