/**
 * Upcoming-appointment reminder card tests (src/briefing/upcomingAppointmentCards.ts) —
 * rolling-48h window logic + warm copy, no native modules, no network.
 *
 * Run with:
 *   npx tsc tests/upcoming_appointment_cards.test.ts src/briefing/upcomingAppointmentCards.ts \
 *     --outDir /tmp/nurture-cards-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   TZ=America/Los_Angeles node /tmp/nurture-cards-tests/tests/upcoming_appointment_cards.test.js
 *
 * The TZ pin keeps the "Today/Tomorrow/weekday" copy deterministic (the logic
 * is device-local by design).
 */

import {
  selectUpcomingAppointmentCards,
  warmWhen48,
  type AppointmentEvent,
} from '../src/briefing/upcomingAppointmentCards';

// No @types/node in the unit-test compile; declare the one global we use.
declare const process: { exit(code: number): void };

// ── tiny harness (repo convention: no framework) ───────────────────────────
let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

// Fixed device clock: Saturday, 2026-09-19 10:00 AM Pacific.
const NOW = Date.parse('2026-09-19T10:00:00-07:00');
const MIN = 60_000;
const HOUR = 3_600_000;

function appt(
  id: string,
  atMs: number,
  data: Record<string, unknown> = {},
): AppointmentEvent {
  return {
    id,
    occurredAt: new Date(atMs).toISOString(),
    data: { title: 'Checkup', ...data },
  };
}

// ── 24h in → included ──────────────────────────────────────────────────────
{
  const cards = selectUpcomingAppointmentCards(
    [appt('a1', NOW + 24 * HOUR, { provider: 'Dr. Izu', location: 'Suite 200', notes: 'Bring list' })],
    NOW,
  );
  check('24h: one card', cards.length, 1);
  check('24h: id passes through', cards[0].id, 'a1');
  check('24h: title passes through', cards[0].title, 'Checkup');
  check('24h: occurredAt passes through', cards[0].occurredAt, new Date(NOW + 24 * HOUR).toISOString());
  check('24h: provider passes through', cards[0].provider, 'Dr. Izu');
  check('24h: location passes through', cards[0].location, 'Suite 200');
  check('24h: notes pass through', cards[0].notes, 'Bring list');
}

// ── 47h in → included (inside the window) ──────────────────────────────────
{
  const cards = selectUpcomingAppointmentCards([appt('a2', NOW + 47 * HOUR)], NOW);
  check('47h: included', cards.length, 1);
}

// ── exactly 48h → included (window is inclusive on both ends) ───────────────
{
  const cards = selectUpcomingAppointmentCards([appt('a3', NOW + 48 * HOUR)], NOW);
  check('exactly 48h: included', cards.length, 1);
}

// ── 49h in → excluded ──────────────────────────────────────────────────────
{
  const cards = selectUpcomingAppointmentCards([appt('a4', NOW + 49 * HOUR)], NOW);
  check('49h: excluded', cards.length, 0);
}

// ── 1 minute ago → excluded (card disappears once passed) ───────────────────
{
  const cards = selectUpcomingAppointmentCards([appt('a5', NOW - MIN)], NOW);
  check('1 min ago: excluded', cards.length, 0);
}

// ── exactly at now → included (boundary belongs to the window) ──────────────
{
  const cards = selectUpcomingAppointmentCards([appt('a6', NOW)], NOW);
  check('exactly now: included', cards.length, 1);
  check('exactly now: warm words', cards[0].when, 'Today at 10:00 AM');
}

// ── multiple in window → soonest first, one card each ───────────────────────
{
  const cards = selectUpcomingAppointmentCards(
    [
      appt('late', NOW + 40 * HOUR, { provider: 'Lab' }),
      appt('past', NOW - 2 * HOUR), // already gone
      appt('mid', NOW + 5 * HOUR),
      appt('soon', NOW + 30 * MIN),
    ],
    NOW,
  );
  check('multiple: 3 cards (past dropped)', cards.length, 3);
  check('multiple: soonest first', cards.map((c) => c.id), ['soon', 'mid', 'late']);
  check('multiple: no N-more fold', cards.every((c) => !('more' in c)), true);
}

// ── empty list → empty ──────────────────────────────────────────────────────
check('empty in → empty out', selectUpcomingAppointmentCards([], NOW), []);

// ── warm "when" copy ────────────────────────────────────────────────────────
{
  check('today', warmWhen48(new Date(NOW + 5 * HOUR).toISOString(), NOW), 'Today at 3:00 PM');
  check(
    'tomorrow',
    warmWhen48(new Date(NOW + 24 * HOUR + 30 * MIN).toISOString(), NOW),
    'Tomorrow at 10:30 AM',
  );
  // NOW is a Saturday; +40h lands Monday.
  check(
    'day after tomorrow',
    warmWhen48(new Date(NOW + 40 * HOUR).toISOString(), NOW),
    'Monday at 2:00 AM',
  );
}

// ── pass-through edge cases ─────────────────────────────────────────────────
{
  const cards = selectUpcomingAppointmentCards(
    [appt('b1', NOW + HOUR, { title: '   ', provider: '', notes: '  ' })],
    NOW,
  );
  check('blank title falls back', cards[0].title, 'Appointment');
  check('blank provider → undefined', cards[0].provider, undefined);
  check('blank notes → undefined', cards[0].notes, undefined);
  // Composer-era `note` key still surfaces as notes.
  const old = selectUpcomingAppointmentCards(
    [appt('b2', NOW + HOUR, { note: 'old key' })],
    NOW,
  );
  check('legacy note key surfaces', old[0].notes, 'old key');
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all upcoming-appointment-card tests passed');
