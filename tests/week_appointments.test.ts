/**
 * Upcoming-appointment priority card tests (src/week/appointments.ts) —
 * pure window/selection/copy logic, no native modules, no network.
 *
 * Run with:
 *   npx tsc tests/week_appointments.test.ts src/week/appointments.ts \
 *     --outDir /tmp/nurture-tests-appt --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   TZ=America/Los_Angeles node /tmp/nurture-tests-appt/tests/week_appointments.test.js
 *
 * The TZ pin keeps the local-day windows deterministic (the logic is
 * device-local by design).
 */

import {
  appointmentTitle,
  selectUpcomingAppointment,
  warmWhen,
  type AppointmentCandidate,
} from '../src/week/appointments';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

/** "now" pinned to a fixed local morning; TZ=America/Los_Angeles expected. */
function fixedNow(): number {
  return new Date(2026, 8, 19, 9, 15, 0).getTime(); // Sat Sep 19 2026 09:15
}

function appt(id: string, d: Date, title = 'Checkup'): AppointmentCandidate {
  return { id, occurredAt: d.toISOString(), data: { title } };
}

const now = fixedNow();
const inHours = (h: number) => new Date(now + h * 3_600_000);

// --- warm words ------------------------------------------------------
ok(
  warmWhen(inHours(5).toISOString(), now) === 'Today at 2:15 PM',
  'today renders as "Today at h:MM AM/PM"',
);
ok(
  warmWhen(inHours(25).toISOString(), now) === 'Tomorrow at 10:15 AM',
  'next day renders as "Tomorrow at …"',
);
{
  const d = new Date(now + 49 * 3_600_000); // Monday Sep 21, 10:15
  const when = warmWhen(d.toISOString(), now);
  ok(when === 'Monday at 10:15 AM', `day+2 renders the weekday (got "${when}")`);
  ok(!/[—;]/.test(when), 'warm words use no em dash or semicolon');
}

// --- selection -------------------------------------------------------
ok(
  selectUpcomingAppointment([], now) === null,
  'no appointments → no card',
);
{
  const past = appt('a1', inHours(-1)); // today 08:15, already passed
  const r = selectUpcomingAppointment([past], now);
  ok(r === null, 'already-passed appointment today is skipped');
}
{
  const later = appt('a1', inHours(6));
  const r = selectUpcomingAppointment([later], now);
  ok(r !== null && r.id === 'a1' && r.when === 'Today at 3:15 PM', 'in-window today renders');
  ok(r !== null && r.more === 0, 'single appointment has more=0');
}
{
  const soonest = appt('a1', inHours(6));
  const second = appt('a2', inHours(30));
  const third = appt('a3', inHours(50));
  const r = selectUpcomingAppointment([third, second, soonest], now);
  ok(r !== null && r.id === 'a1', 'soonest in-window appointment wins');
  ok(r !== null && r.more === 2, 'extra in-window appointments count as +N more');
}
{
  const far = appt('a1', inHours(80)); // beyond day+2
  const r = selectUpcomingAppointment([far], now);
  ok(r === null, 'appointment past day+2 renders no card');
}
{
  const old = appt('a1', inHours(-25)); // yesterday
  const r = selectUpcomingAppointment([old], now);
  ok(r === null, 'yesterday renders no card');
}
{
  const weird = { id: 'a9', occurredAt: 'not-a-date', data: {} };
  const r = selectUpcomingAppointment([weird], now);
  ok(r === null, 'unparseable occurredAt is skipped');
}
{
  const untitled = { id: 'a1', occurredAt: inHours(2).toISOString(), data: {} };
  const r = selectUpcomingAppointment([untitled], now);
  ok(r !== null && r.title === 'Appointment', 'missing title falls back to "Appointment"');
}

// --- title trimming --------------------------------------------------
ok(
  appointmentTitle({ title: '  Growth scan  ' }) === 'Growth scan',
  'title is trimmed',
);
ok(
  appointmentTitle({}) === 'Appointment',
  'title falls back when absent',
);
ok(
  appointmentTitle({ title: 42 }) === 'Appointment',
  'non-string title falls back',
);

// --- copy rules ------------------------------------------------------
{
  const r = selectUpcomingAppointment([appt('a1', inHours(6), 'Midwife visit')], now);
  const hay = [r?.title ?? '', r?.when ?? ''].join(' ');
  ok(!/\{(name|Name)\}/.test(hay), 'card copy leaks no {Name}/{name} tokens');
  ok(!/[;—]/.test(hay), 'card copy has no semicolons or em dashes');
}

console.log(`week_appointments: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
