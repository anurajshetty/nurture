/**
 * Appointment reminder timing (Anuraj-approved mockup 14, Sept 2026).
 *
 * Pure module: the preset list, the "N hours/days before" labels, and the
 * conversion between stored lead-minutes and the custom stepper's
 * { n, unit } value. No database, no Expo imports — safe to unit-test
 * with node.
 *
 * The reminder timing editor (ReminderTimingSheet) edits ONE appointment's
 * own lead time, stored on the event's `data` bag as `reminderLeadMinutes`.
 * The global `Prefs.appointmentLeadMinutes` (2 days) remains the DEFAULT
 * for appointments that never set their own value — the You tab's
 * lead-time stepper still edits that global default. The sheet names the
 * visit in its context line so she always knows what the reminder is for.
 */

/** One-tap presets in the editor, in display order. */
export interface ReminderPreset {
  minutes: number;
  label: string;
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { minutes: 60, label: '1 hour before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

/** The default lead time for a fresh install (2 days). Mirrors DEFAULT_PREFS. */
export const DEFAULT_REMINDER_MINUTES = 2880;

/**
 * `data`-bag key for an appointment's OWN reminder lead time (minutes).
 * Stored per appointment by the timing editor; the global
 * `Prefs.appointmentLeadMinutes` stays the default for appointments that
 * never set one.
 */
export const EVENT_REMINDER_MINUTES_KEY = 'reminderLeadMinutes';

/**
 * One appointment's reminder lead time: its own stored value wins,
 * otherwise the supplied default (the global `Prefs.appointmentLeadMinutes`).
 * A corrupted or non-positive stored value falls back too. Never throws.
 */
export function appointmentLeadMinutes(
  data: Record<string, unknown> | null | undefined,
  defaultMinutes: number,
): number {
  const raw = data?.[EVENT_REMINDER_MINUTES_KEY];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  return defaultMinutes;
}

/** Custom stepper bounds (the mockup's typeable number is 1–99). */
export const CUSTOM_MIN = 1;
export const CUSTOM_MAX = 99;

export type ReminderUnit = 'hour' | 'day';

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} before`;
}

/**
 * "1 hour before" / "3 hours before" / "1 day before" / "2 days before" /
 * "1 week before" — preset labels verbatim, then the same shape for any
 * other value: whole days ("5 days before"), whole hours ("12 hours
 * before"), otherwise minutes ("45 min before"). Never throws.
 */
export function formatLeadLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (!Number.isFinite(minutes) || minutes <= 0) return '2 days before';
  const m = Math.round(minutes);
  if (m % 1440 === 0) return plural(m / 1440, 'day');
  if (m % 60 === 0) return plural(m / 60, 'hour');
  return `${m} min before`;
}

/** "Reminder set — 3 hours before": the confirmation toast after a change. */
export function formatReminderSetToast(minutes: number): string {
  return `Reminder set — ${formatLeadLabel(minutes)}`;
}

/** "We'll remind you 2 days before.": the custom stepper's live preview. */
export function formatReminderPreview(n: number, unit: ReminderUnit): string {
  return `We’ll remind you ${plural(n, unit)}.`;
}

export interface CustomTiming {
  n: number;
  unit: ReminderUnit;
}

/** Clamp the typeable number into the 1–99 range. Non-numeric → 1. */
export function clampCustomN(raw: number): number {
  if (!Number.isFinite(raw)) return CUSTOM_MIN;
  return Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.floor(raw)));
}

/**
 * Seed the custom stepper from a stored lead-minutes value: whole days
 * stay days, whole hours stay hours, anything else rounds to the nearest
 * hour. Preset values map exactly (2880 → {2, day}, 60 → {1, hour}).
 */
export function minutesToCustom(minutes: number): CustomTiming {
  if (!Number.isFinite(minutes) || minutes <= 0) return { n: 2, unit: 'day' };
  const m = Math.round(minutes);
  if (m % 1440 === 0) return { n: clampCustomN(m / 1440), unit: 'day' };
  return { n: clampCustomN(Math.round(m / 60)), unit: 'hour' };
}

/** The custom stepper's { n, unit } back to stored lead-minutes. */
export function customToMinutes(n: number, unit: ReminderUnit): number {
  return clampCustomN(n) * (unit === 'day' ? 1440 : 60);
}
