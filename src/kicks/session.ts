/**
 * Kick counter — pure session helpers (Willow, Anuraj approved Sept 20, 2026).
 *
 * Dependency-free (only erased type imports) so everything here is
 * unit-testable under plain node, following the src/plan/questions.ts
 * pattern. Never throws outward.
 */

import type { LocalEvent } from '../lib/types';
import type { KickSession, KickStrength } from './types';
import { displayWeekRange, toISODate } from '../onboarding/dates';

export type { KickSession, KickStrength };

/** The kick pill + home card appear from displayed week 19 (Anuraj's call). */
export const KICKS_MIN_WEEK = 19;

/** Sessions auto-complete at ten movements (approved counting screen). */
export const KICK_SESSION_TARGET = 10;

/** True when the kick feature may appear for the DISPLAYED week number
 *  (completed weeks + 1 — the single shared week rule). */
export function kicksVisibleForDisplayedWeek(displayedWeek: number): boolean {
  return displayedWeek >= KICKS_MIN_WEEK;
}

/**
 * The kick sessions whose local calendar date falls inside the DISPLAYED
 * week number's date range ([startISO, endISO) from displayWeekRange).
 * `occurredAt` is an ISO timestamp — the date part is compared
 * lexicographically against the YYYY-MM-DD bounds. Newest first (the
 * input order is preserved). Empty when the due date or week is invalid.
 * Pure.
 */
export function sessionsInDisplayedWeek(
  all: readonly KickSession[],
  dueISO: string,
  displayedWeek: number,
): KickSession[] {
  const range = displayWeekRange(dueISO, displayedWeek);
  if (!range) return [];
  return all.filter((s) => {
    // Device-local calendar day: a 11:30pm session stays on "today" even
    // though its UTC ISO date has already rolled over.
    const day = toISODate(new Date(s.occurredAt));
    return day >= range.startISO && day < range.endISO;
  });
}

export const KICK_STRENGTHS: readonly KickStrength[] = [
  'fluttery',
  'usual',
  'strong',
];

export function isKickStrength(value: unknown): value is KickStrength {
  return (
    typeof value === 'string' &&
    (KICK_STRENGTHS as readonly string[]).includes(value)
  );
}

/** Coarse ordering for "weaker than usual" comparisons. Pure. */
export function strengthLevel(s: KickStrength): number {
  return s === 'fluttery' ? 0 : s === 'usual' ? 1 : 2;
}

function cleanCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 0 ? n : null;
}

/**
 * Parses a kick_session payload. Tolerates anything: malformed entries
 * return null, never throw. Accepts `movements`/`count` and
 * `durationSec`/`durationMin`/`minutes` spellings (the obVisit export
 * already writes count/durationMin/minutes — see src/export/obVisit.ts).
 */
export function readKickSessionFromData(
  id: string,
  data: Record<string, unknown> | undefined,
  occurredAt: string,
): KickSession | null {
  if (!data || typeof id !== 'string' || id.length === 0) return null;
  const raw = data as Record<string, unknown>;
  const movements =
    cleanCount(raw.movements) ?? cleanCount(raw.count);
  if (movements === null) return null;
  let durationSec = cleanCount(raw.durationSec);
  if (durationSec === null) {
    const min = cleanCount(raw.durationMin) ?? cleanCount(raw.minutes);
    durationSec = min === null ? 0 : min * 60;
  }
  const strength = isKickStrength(raw.strength) ? raw.strength : null;
  return { id, movements, durationSec, strength, occurredAt };
}

/** Reads a kick session off an event. Pure. */
export function readKickSession(event: LocalEvent): KickSession | null {
  if (event.type !== 'kick_session') return null;
  return readKickSessionFromData(event.id, event.data, event.occurredAt);
}

/* ------------------------------------------------------------------ */
/* Display formatting                                                  */
/* ------------------------------------------------------------------ */

/** "18 minutes" / "45 seconds" — feed card + summary headline. */
export function formatDurationLong(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return s === 1 ? '1 second' : `${s} seconds`;
  const m = Math.round(s / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/** "8 min" / "45 sec" — appointment KICKS rows. */
export function formatDurationShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} sec`;
  return `${Math.round(s / 60)} min`;
}

/** "10 movements in 18 minutes" / "1 movement in 40 seconds". */
export function formatMovementsLine(session: {
  movements: number;
  durationSec: number;
}): string {
  const n = session.movements;
  const moves = n === 1 ? '1 movement' : `${n} movements`;
  return `${moves} in ${formatDurationLong(session.durationSec)}`;
}

/**
 * "3 sessions this week · 30 movements" / "1 session this week · 10
 * movements" — the Home card's week summary line (round 4, mockup 21
 * rev2). Pure.
 */
export function formatWeekSummary(
  sessions: readonly KickSession[],
): string {
  const n = sessions.length;
  const movements = sessions.reduce((sum, s) => sum + s.movements, 0);
  const sessionWord = n === 1 ? '1 session' : `${n} sessions`;
  const movementWord =
    movements === 1 ? '1 movement' : `${movements} movements`;
  return `${sessionWord} this week · ${movementWord}`;
}

/** "Mostly fluttery." — the optional strength note. Null when skipped. */
export function formatStrengthNote(strength: KickStrength | null): string | null {
  if (!strength) return null;
  return `Mostly ${strength}.`;
}

/** "Today · 7:42 PM" / "Yesterday · 9:15 PM" / "Sep 20 · 7:42 PM". */
export function formatKickDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const dayMs = 86_400_000;
  const dayDiff = Math.round(
    (startOf(now).getTime() - startOf(d).getTime()) / dayMs,
  );
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (dayDiff === 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Yesterday · ${time}`;
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${date} · ${time}`;
}

/** "Sep 20" — appointment KICKS rows. */
export function formatKickDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "9:15 PM" — the feed card's time prefix. */
export function formatKickTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Sunday · 7:42 PM" — the counting summary's session line. */
export function formatKickWeekdayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  return `${weekday} · ${formatKickTime(iso)}`;
}

/** "0:00" / "1:05" — the counting screen's elapsed timer. */
export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
