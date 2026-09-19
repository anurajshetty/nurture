/**
 * Appointment intake helpers (Logs-tab Add button, Anuraj-approved Sept 2026).
 *
 * Pure, UI-free, and unit-tested: combines the sheet's calendar date with
 * its time-of-day into one `occurredAt`, and builds the same appointment
 * event shape the Composer's "Save as appointment?" proposal uses
 * ({ type:'appointment', occurredAt, data:{ title, note, provider } }).
 * The Plan tab (Epic 6 reminders) and the Week appointment card read this
 * contract — keep it in sync with `src/composer/intent.ts`.
 */
import type { EventInput } from '../lib/types';

export interface AppointmentDraft {
  /** What it's for (free text; blank falls back to "Appointment"). */
  what: string;
  /** Calendar day (time-of-day ignored). */
  date: Date;
  /** Time of day (calendar day ignored). */
  time: Date;
  /** "With whom / where" free text. */
  where: string;
}

/** Merges a calendar date with a time-of-day into one local Date. */
export function combineDateTime(date: Date, time: Date): Date {
  const d = new Date(date);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

/**
 * Builds the appointment EventInput from the intake sheet draft.
 * Warm defaults: an untitled appointment is just "Appointment", and the
 * "with whom / where" line doubles as the note and the provider so the
 * Plan detail's when/where row picks it up.
 */
export function buildAppointmentInput(draft: AppointmentDraft): EventInput {
  const when = combineDateTime(draft.date, draft.time);
  const title = draft.what.trim() || 'Appointment';
  const where = draft.where.trim();
  return {
    type: 'appointment',
    occurredAt: when.toISOString(),
    data: { title, note: where, provider: where },
    visibility: 'private',
  };
}

/** "10:30 AM" — pill labels in her locale. */
export function formatTime(d: Date): string {
  try {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    const h24 = d.getHours();
    const ap = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  }
}

/** "14:30" — the value format `<input type="time">` needs. */
export function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Parses an `<input type="time">` value ("HH:MM") onto the given date's
 * calendar day. Returns null on garbage input — the caller keeps the old time.
 */
export function parseTimeInputValue(value: string, base: Date): Date | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return d;
}
