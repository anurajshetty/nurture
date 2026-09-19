/**
 * Epic 8 — OB-visit export: date-range picker logic (pure, UI-agnostic).
 *
 * Range presets: 'since_last_visit' (default, confirmed with Anuraj Sept 17),
 * 'last_30_days', and 'custom'.
 *
 * "Since last visit" resolves in this order:
 *   1. An explicit last-visit date the user saved (local kv — see below).
 *   2. The most recent *past* appointment event in her journal.
 *   3. Fallback: 30 days ago (so the range is never empty-by-construction).
 *
 * LAST-VISIT DATE STORAGE CHOICE (documented per the Epic 8 brief): a plain
 * key/value row in the local SQLite `kv` table (`export.last_visit_date`,
 * YYYY-MM-DD), via `kvGet`/`kvSet` from `../lib/db` — the same store that
 * already holds notification prefs. A pregnancy-level field was rejected:
 * the last-visit date is *app state* (when she last went / last exported),
 * not pregnancy data — it survives pregnancy switches, stays on-device,
 * and never syncs. This module stays dependency-free; the UI layer passes
 * the stored value in and writes it back with `kvSet`.
 *
 * Dates are calendar-day ISO strings (YYYY-MM-DD) in device-local time.
 * `endISO` is EXCLUSIVE (one day past the last included day), which matches
 * `listEventsInRange(startISO, endISO)` in `../sync/store`.
 */

import type { LocalEvent } from '../lib/types';

/** Key in the local `kv` table holding the explicit last-visit date (YYYY-MM-DD). */
export const LAST_VISIT_KV_KEY = 'export.last_visit_date';

export type RangePreset = 'since_last_visit' | 'last_30_days' | 'custom';

/** Where the resolved "since last visit" start came from. */
export type RangeSource = 'stored' | 'appointment' | 'fallback' | 'last_30_days' | 'custom';

export interface ResolvedRange {
  /** Inclusive start, YYYY-MM-DD. */
  startISO: string;
  /** Exclusive end, YYYY-MM-DD (one day past the last included day). */
  endISO: string;
  /** Human label, e.g. "Sep 2 – Sep 17, 2026". */
  label: string;
  source: RangeSource;
}

export interface RangeInputs {
  preset: RangePreset;
  /** "Now" — injectable so unit tests don't depend on the clock. */
  now: Date;
  /** Journal events (used to find past appointments). */
  events?: LocalEvent[];
  /** Explicit last-visit date from kv (YYYY-MM-DD), or null. */
  storedLastVisitISO?: string | null;
  /** Custom range bounds (YYYY-MM-DD); required when preset is 'custom'. */
  customStartISO?: string;
  customEndISO?: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDay(iso: string | undefined): iso is string {
  if (!iso || !ISO_DAY.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISODate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODateLocal(d);
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Formats an inclusive range for display, e.g. "Sep 2 – Sep 17, 2026".
 * `endExclusiveISO` is the exclusive end (one past the last included day).
 */
export function formatRangeLabel(startISO: string, endExclusiveISO: string): string {
  const endInclusive = addDaysISODate(endExclusiveISO, -1);
  const s = new Date(`${startISO}T12:00:00`);
  const e = new Date(`${endInclusive}T12:00:00`);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const sLabel = `${MONTHS[s.getMonth()]} ${s.getDate()}`;
  if (startISO === endInclusive) return `${sLabel}, ${s.getFullYear()}`;
  if (sameMonth) return `${sLabel} – ${e.getDate()}, ${e.getFullYear()}`;
  const eLabel = `${MONTHS[e.getMonth()]} ${e.getDate()}`;
  return sameYear
    ? `${sLabel} – ${eLabel}, ${e.getFullYear()}`
    : `${sLabel}, ${s.getFullYear()} – ${eLabel}, ${e.getFullYear()}`;
}

/**
 * The most recent past appointment's calendar day (YYYY-MM-DD), or null.
 * Future appointments are ignored — the "last visit" is always in the past.
 */
export function findLastVisitDate(events: LocalEvent[], now: Date): string | null {
  const nowMs = now.getTime();
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const e of events) {
    if (e.type !== 'appointment' || e.deletedAt) continue;
    const t = Date.parse(e.occurredAt);
    if (Number.isNaN(t) || t > nowMs) continue;
    if (t > bestMs) {
      bestMs = t;
      best = e.occurredAt.slice(0, 10);
    }
  }
  return best;
}

/** Validates a YYYY-MM-DD custom bound; throws a plain-language error. */
function requireDay(iso: string | undefined, which: 'start' | 'end'): string {
  if (!isValidDay(iso)) {
    throw new Error(
      `Pick a valid ${which} date (YYYY-MM-DD) for your custom range.`,
    );
  }
  return iso;
}

/**
 * Resolves a range preset to concrete calendar-day bounds. Never throws
 * except for an invalid custom range (the UI surfaces that message).
 */
export function resolveRange(inputs: RangeInputs): ResolvedRange {
  const { preset, now, events = [], storedLastVisitISO = null } = inputs;
  const todayISO = toISODateLocal(now);
  const endISO = addDaysISODate(todayISO, 1); // exclusive

  if (preset === 'last_30_days') {
    const startISO = addDaysISODate(todayISO, -29);
    return { startISO, endISO, label: formatRangeLabel(startISO, endISO), source: 'last_30_days' };
  }

  if (preset === 'custom') {
    const startISO = requireDay(inputs.customStartISO, 'start');
    const endRaw = requireDay(inputs.customEndISO, 'end');
    if (endRaw < startISO) {
      throw new Error('The end date is before the start date — swap them?');
    }
    const customEndISO = addDaysISODate(endRaw, 1);
    return {
      startISO,
      endISO: customEndISO,
      label: formatRangeLabel(startISO, customEndISO),
      source: 'custom',
    };
  }

  // 'since_last_visit' (default)
  if (storedLastVisitISO && isValidDay(storedLastVisitISO)) {
    return {
      startISO: storedLastVisitISO,
      endISO,
      label: formatRangeLabel(storedLastVisitISO, endISO),
      source: 'stored',
    };
  }
  const apptDay = findLastVisitDate(events, now);
  if (apptDay) {
    return {
      startISO: apptDay,
      endISO,
      label: formatRangeLabel(apptDay, endISO),
      source: 'appointment',
    };
  }
  const startISO = addDaysISODate(todayISO, -29);
  return { startISO, endISO, label: formatRangeLabel(startISO, endISO), source: 'fallback' };
}
