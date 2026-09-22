/**
 * Timeline day grouping (Epic 3.1; day groups approved by Anuraj Sept 20,
 * 2026, superseding the week bands).
 *
 * Pure module: no database, no Expo imports — safe to unit-test with node.
 *
 * Grouping decision: the feed groups entries by the LOCAL calendar day
 * they were logged — "Today", "Yesterday", "Friday, Sep 18" — newest day
 * first, newest entry first within the day. The week pill is a pure
 * FILTER now; it no longer renders as a divider. The pregnancy-week
 * helpers below stay: the week filter matches on the same completed-week
 * formula as ever.
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
 *
 * NOTE: pass the event's STORY date (storyDateOf), not occurredAt raw —
 * appointment cards belong to the week they were logged in.
 */
export function pregnancyWeekForEvent(dueDate: string, occurredAt: string): number | null {
  // The event's DEVICE-LOCAL calendar day — never the UTC date slice.
  // The week filter must agree with day grouping (localDayISO) and the
  // current-week pill (todayISO): an 11:30 PM entry belongs to the week
  // containing its local day. Slicing the UTC date part pushed evening
  // entries into the next UTC day's week, so on the night before a week
  // boundary the whole current-week feed rendered empty while "All
  // weeks" still showed the entries (Anuraj caught live, Sept 2026).
  // A bare YYYY-MM-DD input is already a calendar day — use it as-is.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurredAt.trim());
  const day = bare ? bare[0] : localDayISO(occurredAt);
  if (day === null) return null;
  return pregnancyWeekForDay(dueDate, day);
}

/**
 * The date an entry sits at in the story (Anuraj, Sept 2026): EVERY new
 * report, log, or appointment goes to the top of the current day's feed
 * section, so entries sort and day-group by CREATION date — never by
 * subject date (not the appointment's scheduled date, not a report's
 * document date). Pure — the feed's ORDER BY, day grouping, and week
 * filter all funnel through this one function so they can never disagree.
 */
export function storyDateOf(event: LocalEvent): string {
  return event.createdAt || event.occurredAt;
}

/* ------------------------------------------------------------------ */
/* Day grouping (Willow, Anuraj Sept 20, 2026): the feed groups entries */
/* by the LOCAL calendar day they were logged — "Today", "Yesterday",  */
/* "Friday, Sep 18" — newest day first, newest entry first within the  */
/* day. Grouping is on the story date (storyDateOf) in the DEVICE's    */
/* timezone, so an 11:58 PM entry and a 12:03 AM entry land in         */
/* different groups.                                                   */
/* ------------------------------------------------------------------ */

/**
 * Local-calendar YYYY-MM-DD for an ISO timestamp, in the device's
 * timezone. Null when the timestamp doesn't parse.
 */
export function localDayISO(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add (or subtract) whole days to a YYYY-MM-DD date. Null on bad input. */
function addDaysToDay(dayISO: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (!m) return null;
  // Noon-local sidesteps DST edges; only the calendar day matters.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * "Today" / "Yesterday" / "Friday, Sep 18" — the day-group label for a
 * local YYYY-MM-DD day, relative to the device-local today.
 */
export function formatDayGroupLabel(dayISO: string, todayLocalISO: string): string {
  if (dayISO === todayLocalISO) return 'Today';
  if (dayISO === addDaysToDay(todayLocalISO, -1)) return 'Yesterday';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (!m) return dayISO;
  // Noon-local sidesteps DST edges; only the weekday matters.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return `${WEEKDAYS[d.getDay()]}, ${formatDayShort(dayISO)}`;
}

/**
 * Groups events into day sections, newest day first; within a day,
 * newest event first. Accepts unsorted input; returns [] for no events.
 *
 * `todayLocalISO` pins the "Today"/"Yesterday" labels (defaults to the
 * device-local today) — pass it explicitly in tests for determinism.
 */
export function buildDaySections(
  events: LocalEvent[],
  todayLocalISO?: string,
): TimelineSection[] {
  const today = todayLocalISO ?? localDayISO(new Date().toISOString()) ?? '';
  const sorted = [...events].sort((a, b) => {
    const sa = storyDateOf(a);
    const sb = storyDateOf(b);
    return sa < sb ? 1 : sa > sb ? -1 : 0;
  });
  const entries = new Map<string, TimelineSection>();
  for (const event of sorted) {
    const day = localDayISO(storyDateOf(event));
    if (!day) continue;
    let section = entries.get(day);
    if (!section) {
      section = {
        key: `day-${day}`,
        title: formatDayGroupLabel(day, today),
        subtitle: '',
        data: [],
      };
      entries.set(day, section);
    }
    section.data.push(event);
  }
  // Keys are `day-YYYY-MM-DD`, so lexicographic order is chronological.
  return [...entries.values()].sort((a, b) =>
    a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
  );
}

/**
 * The completed pregnancy week "she's in" for a due date — the SAME week
 * number the week filter matches on (pregnancyWeekForEvent for an event
 * logged today). Out-of-range days clamp to the 1…42 band; null when
 * dates don't parse or the pregnancy hasn't begun.
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
 * Display = completed + 1, so the current-week pill and the week-filter
 * options always read the same week.
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

