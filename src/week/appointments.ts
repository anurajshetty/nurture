/**
 * Upcoming-appointment priority card (Week screen).
 *
 * Pure, on-device logic: given the device's appointment events and the
 * current time, picks the card payload — or null when nothing is close
 * enough to mention.
 *
 * Window (Anuraj, Sept 2026): occurredAt >= start of today (local) and
 * <= end of day+2 (local), skipping anything already passed today.
 * The soonest in-window appointment renders; extra in-window ones fold
 * into a quiet "+N more" line.
 *
 * This module is dependency-free so it unit-tests under plain node.
 */

export interface AppointmentCandidate {
  id: string;
  occurredAt: string; // ISO
  data: Record<string, unknown>;
}

export interface UpcomingAppointment {
  id: string;
  title: string;
  /** Warm words: "Today at 3:00 PM", "Tomorrow at 10:30 AM", "Thursday at 9:00 AM". */
  when: string;
  /** In-window appointments beyond the soonest. 0 when the soonest is alone. */
  more: number;
}

const DAY_MS = 86_400_000;

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
 * Warm words for an in-window appointment time: "Today at 3:00 PM",
 * "Tomorrow at 10:30 AM", or "Thursday at 9:00 AM" for day+2.
 * dayIndex is 0/1/2 relative to today (local calendar days).
 */
export function warmWhen(occurredAt: string, nowMs: number): string {
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

/** Trims to a row-safe title; falls back when she never named it. */
export function appointmentTitle(
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
 * Picks the priority-card payload: the soonest appointment inside the
 * window (today..day+2, local; nothing already passed), or null when no
 * candidate qualifies. `more` counts the other in-window appointments.
 */
export function selectUpcomingAppointment(
  events: AppointmentCandidate[],
  nowMs: number,
): UpcomingAppointment | null {
  const windowStart = startOfDayLocal(nowMs);
  const windowEnd = windowStart + 3 * DAY_MS; // exclusive: end of day+2
  const inWindow = events
    .map((e) => ({ e, at: Date.parse(e.occurredAt) }))
    .filter(({ at }) => Number.isFinite(at))
    .filter(({ at }) => at >= windowStart && at < windowEnd && at >= nowMs)
    .sort((a, b) => a.at - b.at);
  if (inWindow.length === 0) return null;
  const [first, ...rest] = inWindow;
  return {
    id: first.e.id,
    title: appointmentTitle(first.e.data),
    when: warmWhen(first.e.occurredAt, nowMs),
    more: rest.length,
  };
}
