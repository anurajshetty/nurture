/**
 * Upcoming-appointment reminder cards (Home screen).
 *
 * UI consumption (planned):
 * - Home calls selectUpcomingAppointmentCards(events, Date.now()) and renders
 *   one card per returned payload, ABOVE the "Highlights this week" section.
 * - Tapping a card opens the appointment editor for that appointment — wire
 *   the tap to the card's `id` (UI-side; nothing to do in this module).
 * - When the list is empty, no card area renders at all.
 *
 * Scheduling (Anuraj, Sept 19 2026): a ROLLING 48-hour window on the device
 * clock — an appointment qualifies when now <= occurredAt <= now + 48h,
 * sorted soonest-first. Anything already passed is excluded automatically,
 * so a card "disappears" the moment its appointment time is behind us.
 * One card per qualifying appointment (unlike the Week screen's soonest +
 * "N more" priority card — see src/week/appointments.ts, not reused here).
 *
 * Pure, on-device logic. Dependency-free at module scope so it unit-tests
 * under plain node.
 */

export interface AppointmentEvent {
  id: string;
  occurredAt: string; // ISO
  data: Record<string, unknown>;
}

/** One reminder card for the Home screen. */
export interface UpcomingAppointmentCard {
  id: string;
  title: string;
  /** ISO time the appointment occurs. */
  occurredAt: string;
  /** Warm words: "Today at 3:00 PM", "Tomorrow at 10:30 AM", "Monday at 9:00 AM". */
  when: string;
  /** Who she sees (may be undefined when she never named one). */
  provider?: string;
  /** Where it is (may be undefined when she never named one). */
  location?: string;
  /** Her notes for the visit (may be undefined). */
  notes?: string;
}

const DAY_MS = 86_400_000;
const WINDOW_MS = 2 * DAY_MS; // rolling 48 hours

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Local midnight (start of the day) containing ms, in the device timezone. */
function startOfDayLocal(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "3:00 PM" — 12-hour clock, no leading zero, as spoken. */
function timeWords(d: Date): string {
  const h24 = d.getHours();
  const mins = d.getMinutes();
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mins).padStart(2, '0')} ${ampm}`;
}

/**
 * Warm words for a card time: "Today at 3:00 PM", "Tomorrow at 10:30 AM",
 * or "Monday at 9:00 AM" when the appointment lands on a later calendar day.
 * Inside a rolling 48h window the day is today, tomorrow, or day-after.
 */
export function warmWhen48(occurredAt: string, nowMs: number): string {
  const d = new Date(occurredAt);
  const dayIndex = Math.round(
    (startOfDayLocal(d.getTime()) - startOfDayLocal(nowMs)) / DAY_MS,
  );
  const label =
    dayIndex <= 0
      ? 'Today'
      : dayIndex === 1
        ? 'Tomorrow'
        : WEEKDAYS[d.getDay()];
  return `${label} at ${timeWords(d)}`;
}

/** Trims to a card-safe title; falls back when she never named it. */
export function appointmentCardTitle(
  data: Record<string, unknown>,
  fallback = 'Appointment',
): string {
  const raw = data.title;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.length > 0)
      return t.length > 80 ? t.slice(0, 77).trimEnd() + '…' : t;
  }
  return fallback;
}

/**
 * Passes a data field through as a trimmed string, or undefined when the
 * field is absent/blank — UI renders nothing rather than an empty row.
 */
function optionalText(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = data[key];
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t.length > 0) return t;
    }
  }
  return undefined;
}

/**
 * Returns one card per appointment inside the rolling 48-hour window
 * (now <= t <= now + 48h), soonest-first. Appointments that already passed
 * — even a minute ago — are excluded. Empty in, empty out.
 *
 * notes accepts the composer-era `note` key as well as `notes`.
 */
export function selectUpcomingAppointmentCards(
  events: AppointmentEvent[],
  nowMs: number,
): UpcomingAppointmentCard[] {
  const windowEnd = nowMs + WINDOW_MS; // inclusive: exactly-48h counts
  return events
    .map((e) => ({ e, at: Date.parse(e.occurredAt) }))
    .filter(({ at }) => Number.isFinite(at))
    .filter(({ at }) => at >= nowMs && at <= windowEnd)
    .sort((a, b) => a.at - b.at)
    .map(({ e }) => ({
      id: e.id,
      title: appointmentCardTitle(e.data),
      occurredAt: e.occurredAt,
      when: warmWhen48(e.occurredAt, nowMs),
      provider: optionalText(e.data, 'provider'),
      location: optionalText(e.data, 'location'),
      notes: optionalText(e.data, 'notes', 'note'),
    }));
}
