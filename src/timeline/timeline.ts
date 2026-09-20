/**
 * Timeline week-band grouping (Epic 3.1).
 *
 * Pure module: no database, no Expo imports — safe to unit-test with node.
 *
 * Grouping decision: the backlog draft said "grouped by day, then week",
 * but the approved v1 mockup (design/03-timeline.html, Anuraj Sept 17)
 * shows week bands — "Week 24" + date range "Sep 14 – 20" — with
 * per-card relative timestamps ("Today · 9:12 AM") and NO day sub-headers.
 * The mockup wins: sections are week bands only.
 */

import { addDaysISO, gestationalDays, pregnancyWeek, todayISO } from '../onboarding/dates';
import type { LocalEvent } from '../lib/types';

export interface TimelineSection {
  key: string;
  title: string;
  subtitle: string;
  data: LocalEvent[];
}

/** YYYY-MM-DD week bounds for pregnancy `week` (1-based) given a due date.
 * `endISO` is exclusive (start + 7 days). Null when the week is invalid. */
export function pregnancyWeekRange(
  week: number,
  dueDate: string,
): { startISO: string; endISO: string } | null {
  if (!Number.isInteger(week) || week < 1) return null;
  // Day 0 of the pregnancy is dueDate − 280 (the LMP date); under the one
  // shared convention (pregnancyWeek in onboarding/dates), completed week W
  // covers gestational days W·7 … W·7+6, so week W starts W·7 days after
  // the LMP — e.g. week 37 starts 2026-09-17 for a 2026-10-08 due date.
  const startISO = addDaysISO(dueDate, -280 + week * 7);
  if (!startISO) return null;
  const endISO = addDaysISO(startISO, 7);
  if (!endISO) return null;
  return { startISO, endISO };
}

/* ------------------------------------------------------------------ */
/* Pregnancy-week wrappers. There is exactly ONE completed-week          */
/* calculation: pregnancyWeek() in onboarding/dates (completed weeks =  */
/* floor((day − LMP) / 7), LMP = due − 280 days). All internal grouping, */
/* range math, and filter matching funnel through it.                    */
/*                                                                       */
/* ALL user-facing "Week N" labels (pill, filter dropdown, divider      */
/* bands) show the DISPLAY week = completed + 1 (Anuraj, Sept 2026) via  */
/* displayWeek() in onboarding/dates and the display wrappers below —   */
/* never the completed number on its own.                               */
/* ------------------------------------------------------------------ */

/**
 * Completed pregnancy week for a due date and a YYYY-MM-DD calendar day.
 * Out-of-range days clamp to the nearest band (1…42) — including days
 * before the LMP, so every card always lands somewhere warm, never
 * nowhere. Null on bad input.
 */
export function pregnancyWeekForDay(dueDate: string, dayISO: string): number | null {
  const g = gestationalDays(dueDate, dayISO);
  if (g === null) return null;
  // pregnancyWeek is null exactly when g < 0 (pregnancy not yet begun);
  // those days clamp to band 1 rather than vanishing.
  const w = pregnancyWeek(dueDate, dayISO) ?? 0;
  return Math.max(1, Math.min(42, w));
}

/**
 * Completed pregnancy week an event belongs to, or null when the dates
 * don't parse. Events before week 1 (or after week 42) clamp to the
 * nearest band so every card always lands somewhere warm, never nowhere.
 */
export function pregnancyWeekForEvent(dueDate: string, occurredAt: string): number | null {
  // The YYYY-MM-DD date part of the ISO timestamp; timezone-neutral.
  return pregnancyWeekForDay(dueDate, occurredAt.slice(0, 10));
}

/**
 * The completed pregnancy week "she's in" for a due date — the SAME week
 * number the timeline dividers use internally (pregnancyWeekForEvent for
 * an event that occurred today). Out-of-range days clamp to the 1…42
 * band; null when dates don't parse or the pregnancy hasn't begun.
 */
export function currentPregnancyWeek(dueDate: string, asOfISO: string = todayISO()): number | null {
  const w = pregnancyWeek(dueDate, asOfISO);
  return w === null ? null : Math.max(1, Math.min(42, w));
}

/**
 * The user-facing DISPLAY week for a calendar day: the completed-week
 * band + 1 (Anuraj, Sept 2026). Clamps on the same 1…42 band as
 * pregnancyWeekForDay first, so labels always match a real band.
 * Null on bad input.
 */
export function displayWeekForDay(dueDate: string, dayISO: string): number | null {
  const w = pregnancyWeekForDay(dueDate, dayISO);
  return w === null ? null : w + 1;
}

/**
 * The user-facing display week "she's in" — the pill/dropdown number.
 * Display = completed + 1, so the current-week pill and the dividers
 * always read the same week.
 */
export function currentDisplayWeek(dueDate: string, asOfISO: string = todayISO()): number | null {
  const w = currentPregnancyWeek(dueDate, asOfISO);
  return w === null ? null : w + 1;
}

/**
 * "Week 38" — the user-facing label for a completed-week number. Every
 * "Week N" label in the app goes through this one formatting site.
 */
export function displayWeekLabel(completedWeek: number): string {
  return `Week ${completedWeek + 1}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Sep 14" — short warm day label from a YYYY-MM-DD date. */
export function formatDayShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/**
 * "Sep 14 – 20": week range from an inclusive start and exclusive end
 * (YYYY-MM-DD). Spanning months → "Sep 28 – Oct 4".
 */
export function formatWeekRange(startISO: string, endISOExclusive: string): string {
  const endInclusive = addDaysISO(endISOExclusive, -1) ?? endISOExclusive;
  const start = formatDayShort(startISO);
  const end = formatDayShort(endInclusive);
  if (startISO.slice(5, 7) === endInclusive.slice(5, 7)) {
    const endDay = endInclusive.slice(8).replace(/^0/, '');
    return `${start} – ${endDay}`;
  }
  return `${start} – ${end}`;
}

/** Monday (week start) of the calendar week containing `dayISO` (YYYY-MM-DD). */
function mondayOfWeek(dayISO: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (!m) return null;
  // Noon-local avoids DST edge cases; only the calendar day matters.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

interface BandInfo {
  key: string;
  title: string;
  subtitle: string;
  /** Week-start YYYY-MM-DD; sections sort newest-first on this. */
  sortKey: string;
}

/** The week band for one event: pregnancy weeks when a due date is known,
 * otherwise Monday-start calendar weeks ("Week of Sep 14"). */
function bandForEvent(event: LocalEvent, dueDate: string | null): BandInfo | null {
  const day = event.occurredAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  if (dueDate) {
    const week = pregnancyWeekForEvent(dueDate, event.occurredAt);
    const range = week === null ? null : pregnancyWeekRange(week, dueDate);
    if (week === null || !range) return null;
    return {
      key: `preg-${week}`,
      // User-facing divider label: the DISPLAY week (completed + 1).
      // Keys and ranges stay on the completed-week number.
      title: displayWeekLabel(week),
      subtitle: formatWeekRange(range.startISO, range.endISO),
      sortKey: range.startISO,
    };
  }

  const startISO = mondayOfWeek(day);
  const endExclusive = startISO ? addDaysISO(startISO, 7) : null;
  if (!startISO || !endExclusive) return null;
  return {
    key: `cal-${startISO}`,
    title: `Week of ${formatDayShort(startISO)}`,
    subtitle: formatWeekRange(startISO, endExclusive),
    sortKey: startISO,
  };
}

/**
 * Groups events into week-band sections, newest week first; within a band,
 * newest event first. Accepts unsorted input; returns [] for no events.
 */
export function buildSections(
  events: LocalEvent[],
  dueDate: string | null,
): TimelineSection[] {
  const sorted = [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
  const entries = new Map<string, { section: TimelineSection; sortKey: string }>();
  for (const event of sorted) {
    const band = bandForEvent(event, dueDate);
    if (!band) continue;
    let entry = entries.get(band.key);
    if (!entry) {
      entry = {
        section: { key: band.key, title: band.title, subtitle: band.subtitle, data: [] },
        sortKey: band.sortKey,
      };
      entries.set(band.key, entry);
    }
    entry.section.data.push(event);
  }
  return [...entries.values()]
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
    .map((entry) => entry.section);
}
