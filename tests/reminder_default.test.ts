/**
 * Reminder default tests (Anuraj's call, Sept 19, 2026: the mockup-14
 * per-appointment timing editor is dropped ENTIRELY — the 2-day default
 * reminder applies to ALL appointments; no per-appointment customization
 * anywhere).
 *
 * Pins the scheduler behavior: `planAppointmentReminders` uses the global
 * default lead for every appointment and IGNORES any stored per-appointment
 * `data.reminderLeadMinutes` left over from before the drop.
 *
 * Pure modules only — no database, no notifications, no network. Run with:
 *
 *   npx tsc tests/reminder_default.test.ts --outDir /tmp/nurture-rd-tests \
 *     --module commonjs --target es2022 --skipLibCheck --esModuleInterop \
 *     --ignoreConfig
 *   node /tmp/nurture-rd-tests/tests/reminder_default.test.js
 *
 * (tsc follows the relative imports from the test file, so no other source
 * files need to be listed. TZ=UTC keeps the date math deterministic.)
 */

import {
  planAppointmentReminders,
  type PlanInput,
} from '../src/notifications/appointments';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// Fixed "now": 2026-09-22 09:00 local. Tests run under TZ=UTC.
const NOW = new Date(2026, 8, 22, 9, 0, 0).getTime();
const isoAt = (h: number, m = 0, dayOffset = 0): string => {
  const d = new Date(NOW + dayOffset * 86_400_000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** 2-day default lead, the value Prefs.appointmentLeadMinutes carries. */
const TWO_DAYS = 2880;

const baseInput = (): PlanInput => ({
  appointments: [],
  leadMinutes: TWO_DAYS,
  remindersEnabled: true,
  paused: false,
  pregnancyActive: true,
  permissionGranted: true,
  quietStart: '21:00',
  quietEnd: '08:00',
  nowMs: NOW,
});

{
  // Appointment 3 days out, 10:30 AM: 2-day lead -> fires 1 day out at 10:30 AM.
  const input = baseInput();
  input.appointments = [{ id: 'a1', occurredAt: isoAt(10, 30, 3), data: {} }];
  const plans = planAppointmentReminders(input);
  check('2-day default: one plan', plans.length, 1);
  check(
    '2-day default: fires 2 days before',
    plans[0]?.fireAtMs,
    new Date(isoAt(10, 30, 1)).getTime(),
  );
}

{
  // A stored per-appointment override (60 min, from before the drop) is
  // IGNORED — the 2-day default applies to every appointment.
  const input = baseInput();
  input.appointments = [
    { id: 'a1', occurredAt: isoAt(10, 30, 3), data: { reminderLeadMinutes: 60 } },
  ];
  const plans = planAppointmentReminders(input);
  check('stored override ignored: one plan', plans.length, 1);
  check(
    'stored override ignored: fires at the 2-day default',
    plans[0]?.fireAtMs,
    new Date(isoAt(10, 30, 1)).getTime(),
  );
}

{
  // Two appointments with different stored overrides -> both fire at the
  // 2-day default, sorted by fire time.
  const input = baseInput();
  input.appointments = [
    { id: 'b', occurredAt: isoAt(16, 0, 4), data: { reminderLeadMinutes: 180 } },
    { id: 'a', occurredAt: isoAt(11, 0, 3), data: { reminderLeadMinutes: 10080 } },
  ];
  const plans = planAppointmentReminders(input);
  check('overrides ignored on all: two plans', plans.length, 2);
  check(
    'overrides ignored on all: sorted by fire time',
    plans.map((p) => p.eventId),
    ['a', 'b'],
  );
  check(
    'overrides ignored on all: first fires at 2-day default',
    plans[0]?.fireAtMs,
    new Date(isoAt(11, 0, 1)).getTime(),
  );
}

{
  // Malformed stored values are ignored too — the default still applies.
  const input = baseInput();
  input.appointments = [
    {
      id: 'a1',
      occurredAt: isoAt(10, 30, 3),
      data: { reminderLeadMinutes: 'not-a-number' },
    },
  ];
  const plans = planAppointmentReminders(input);
  check('malformed override ignored: one plan', plans.length, 1);
  check(
    'malformed override ignored: fires at the 2-day default',
    plans[0]?.fireAtMs,
    new Date(isoAt(10, 30, 1)).getTime(),
  );
}

console.log(`reminder_default: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
