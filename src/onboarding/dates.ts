/**
 * Pregnancy date math for onboarding (Epic 1.1).
 *
 * Pure functions over YYYY-MM-DD calendar dates — no timezone conversion,
 * because a due date is a calendar date, not a timestamp. All "today"
 * references are the device's local day.
 *
 * Naegele's rule: estimated due date = first day of the last menstrual
 * period + 280 days. The estimate is always shown back for confirmation —
 * never applied silently.
 */

export const GESTATION_DAYS = 280;
export const MAX_GESTATION_DAYS = 42 * 7; // 294 — beyond this, the date is almost certainly wrong
export const MAX_LMP_LOOKBACK_DAYS = 310; // a last period older than this is almost certainly wrong

/** Local midnight today. */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Formats a Date as YYYY-MM-DD using the device's local calendar. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today as YYYY-MM-DD in the device's local calendar. */
export function todayISO(): string {
  return toISODate(startOfToday());
}

/** Parses YYYY-MM-DD strictly; null when the string is not a real calendar date. */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

/** Adds whole days to a YYYY-MM-DD date; null when the input is invalid. */
export function addDaysISO(iso: string, days: number): string | null {
  const d = parseISODate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Adds whole months to a YYYY-MM-DD date, clamping the day when the target
 *  month is shorter (Jan 31 + 1 month → Feb 28); null on invalid input. */
export function addMonthsISO(iso: string, months: number): string | null {
  const d = parseISODate(iso);
  if (!d) return null;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, dim));
  return toISODate(d);
}

/**
 * Appointment scheduled-date picker bounds (Anuraj, Sept 2026): min is
 * today — no past scheduled dates; max is the pregnancy's due date + 2
 * months, so postpartum checkups after delivery stay pickable without the
 * picker running unbounded. Pure — pass the active pregnancy's due date
 * (YYYY-MM-DD) from the record, never a hardcoded date; when no due date
 * is on the record yet (mid-onboarding), the window falls back to
 * today + 2 months.
 */
export function appointmentDateBounds(dueISO: string | null): { min: Date; max: Date } {
  const min = startOfToday();
  const base = (dueISO && parseISODate(dueISO)) || min;
  const maxISO = addMonthsISO(toISODate(base), 2);
  return { min, max: (maxISO && parseISODate(maxISO)) || min };
}

/**
 * Naegele's rule: estimated due date from the first day of the last period.
 * Returns null when the LMP is not a valid date.
 */
export function naegele(lmpISO: string): string | null {
  return addDaysISO(lmpISO, GESTATION_DAYS);
}

/** Whole days from aISO to bISO (b - a); null when either side is invalid. */
export function daysBetween(aISO: string, bISO: string): number | null {
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Gestational age in days on `asOfISO` (defaults to today) for a due date:
 * 280 minus the days remaining until the due date. Null when unparseable.
 */
export function gestationalDays(dueISO: string, asOfISO: string = todayISO()): number | null {
  const remaining = daysBetween(asOfISO, dueISO);
  return remaining === null ? null : GESTATION_DAYS - remaining;
}

/**
 * THE single shared pregnancy-week helper (Anuraj, Sept 2026).
 *
 * Completed gestational weeks as of `asOfISO` (defaults to today): week W
 * covers gestational days W·7 … W·7+6 counted from the LMP (due − 280 days,
 * Naegele's rule). For due 2026-10-08 (LMP 2026-01-01): 2026-09-17 → 37,
 * 2026-09-24 → 38. No per-screen week math — every screen (briefing,
 * Week tab, Logs pill/dividers/filter) routes through this one number.
 * Returns null when a date is unparseable or the pregnancy hasn't begun.
 */
export function pregnancyWeek(dueISO: string, asOfISO: string = todayISO()): number | null {
  const g = gestationalDays(dueISO, asOfISO);
  if (g === null || g < 0) return null;
  return Math.floor(g / 7);
}

/** { week, day } of pregnancy for a due date, or null when not yet pregnant by that date. */
export function weekOf(
  dueISO: string,
  asOfISO: string = todayISO(),
): { week: number; day: number } | null {
  const week = pregnancyWeek(dueISO, asOfISO);
  if (week === null) return null;
  const g = gestationalDays(dueISO, asOfISO);
  if (g === null) return null; // unreachable — pregnancyWeek already parsed both dates
  return { week, day: g % 7 };
}

/**
 * THE user-facing display week (Anuraj, Sept 2026).
 *
 * Displayed week = completed weeks + 1: LMP = EDD − 280 days,
 * completedWeeks = floor((today − LMP) / 7), displayed = completed + 1.
 * For due 2026-10-08: 2026-09-19 → completed 37 → display 38.
 *
 * Every user-facing "Week N" label (Week tab heading, Logs pill, week
 * filter dropdown, timeline dividers) funnels through this number — via
 * the display wrappers in src/timeline/timeline.ts. Internal grouping,
 * range math, and content lookups keep using pregnancyWeek() (completed
 * weeks). Returns null when a date is unparseable or the pregnancy
 * hasn't begun.
 */
export function displayWeek(dueISO: string, asOfISO: string = todayISO()): number | null {
  const w = pregnancyWeek(dueISO, asOfISO);
  return w === null ? null : w + 1;
}

/** "Jan 7, 2027" — warm, short, locale-aware. Falls back to the raw string. */
export function formatLong(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** A kind, plain-language reason a date can't be used — or null when it's fine. */
export interface DateProblem {
  message: string;
}

/**
 * Validates a due date: must be a real date, not already passed, and not
 * impossibly far out. Invalid dates are rejected with a kind message —
 * the caller should block Continue but always offer "I'll do this later".
 */
export function validateDueDate(iso: string | null, asOfISO: string = todayISO()): DateProblem | null {
  if (!iso || !parseISODate(iso)) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  const g = gestationalDays(iso, asOfISO);
  if (g === null) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  if (g < 0) {
    return { message: 'That’s more than 40 weeks away — want to check the date?' };
  }
  if (g > MAX_GESTATION_DAYS) {
    return { message: 'That date looks like it’s already passed — mind double-checking it?' };
  }
  return null;
}

/**
 * Validates a birthday: must be a real date, not in the future, and not
 * implausibly far back. Birthdays are optional everywhere they appear —
 * this only runs when she actually picked one.
 */
export function validateDob(iso: string | null, asOfISO: string = todayISO()): DateProblem | null {
  // Birthdays are optional everywhere — null/blank means "not set", not a problem.
  if (!iso || iso.trim().length === 0) return null;
  if (!parseISODate(iso)) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  const daysAgo = daysBetween(iso, asOfISO);
  if (daysAgo === null) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  if (daysAgo < 0) {
    return { message: 'That date is still ahead of us — mind picking your birthday again?' };
  }
  if (daysAgo > 100 * 365) {
    return { message: 'That was quite a while ago — mind double-checking the date?' };
  }
  return null;
}

/**
 * Validates a last-period date: must be a real date, not in the future,
 * and not implausibly long ago.
 */
export function validateLmp(iso: string | null, asOfISO: string = todayISO()): DateProblem | null {
  if (!iso || !parseISODate(iso)) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  const daysAgo = daysBetween(iso, asOfISO);
  if (daysAgo === null) {
    return { message: 'Hmm — that date didn’t come through. Try picking it again?' };
  }
  if (daysAgo < 0) {
    return { message: 'That date is in the future — your last period started before today.' };
  }
  if (daysAgo > MAX_LMP_LOOKBACK_DAYS) {
    return { message: 'That was quite a while ago — mind double-checking the date?' };
  }
  return null;
}
