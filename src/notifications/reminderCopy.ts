/**
 * Neutral lock-screen copy for Willow reminders (Epic 6).
 *
 * The product rule (mockup 11 §6.1, settings note in the You tab):
 * lock-screen previews are neutral BY DEFAULT — they NEVER show symptoms,
 * moods, or health details. An appointment reminder may show only:
 *   - when the visit is (time / relative day),
 *   - who it's with and where (provider / place, when she saved them),
 *   - that her visit questions are ready.
 *
 * Everything the notification MAY use comes from this module's allowlist.
 * `data.note`, `data.text`, symptom lists, mood values, and any other
 * free-form fields are NEVER read here — a test asserts that even an
 * appointment whose `note` is full of health details renders copy that
 * contains none of it.
 *
 * Time formatting is device-locale via toLocaleTimeString; relative-day
 * labels use the device's calendar day (same buckets as the timeline).
 */

export interface ReminderCopy {
  title: string;
  body: string;
}

/** Collapse whitespace so her typed fields can't smuggle line breaks into the lock screen. */
function cleanLine(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** "10:30 AM" in her locale. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Weekday name ("Tuesday") in her locale. */
function weekdayName(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'long' });
}

/**
 * Relative-day title for the reminder: "Appointment today",
 * "Appointment tomorrow", or "Appointment Tuesday". Pure.
 */
export function appointmentTitle(occurredAt: string, nowMs: number = Date.now()): string {
  const startOf = (t: number): number => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const dayDiff = Math.round((startOf(new Date(occurredAt).getTime()) - startOf(nowMs)) / 86_400_000);
  if (dayDiff <= 0) return 'Appointment today';
  if (dayDiff === 1) return 'Appointment tomorrow';
  if (dayDiff < 7) return `Appointment ${weekdayName(occurredAt)}`;
  return 'Appointment coming up';
}

/**
 * Builds the appointment-reminder copy. Reads ONLY the allowlisted fields
 * (title / provider / place); everything else in `data` is invisible here
 * by construction. Never throws.
 */
export function appointmentReminderCopy(
  occurredAt: string,
  data: Record<string, unknown> | undefined,
  nowMs: number = Date.now(),
): ReminderCopy {
  const d = data ?? {};
  const when = formatClock(occurredAt);
  const who = [cleanLine(d.provider), cleanLine(d.place)].filter(Boolean).join(', ');
  const firstLine = when + (who ? ` · ${who}` : '');
  return {
    title: appointmentTitle(occurredAt, nowMs),
    body: `${firstLine}\nYour questions are ready for the visit.`,
  };
}

/**
 * Where-tuple for the appointment detail header. Same allowlist as the
 * lock screen: title / provider / place only.
 */
export function appointmentWhere(data: Record<string, unknown> | undefined): {
  provider: string;
  place: string;
} {
  const d = data ?? {};
  return { provider: cleanLine(d.provider), place: cleanLine(d.place) };
}

/** Exported for unit tests: the full allowlist, so tests can prove nothing else leaks. */
export const NEUTRAL_COPY_ALLOWLIST = ['occurredAt', 'provider', 'place'] as const;
