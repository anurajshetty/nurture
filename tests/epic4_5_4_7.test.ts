/**
 * Epic 4.5 + 4.7 deterministic tests: appointment date handling (the
 * "When?" picker feeds occurredAt through ProposalBuildOpts, defaulting
 * to today when untouched) and the new milestone trigger phrases — with
 * no-conflict coverage against appointment/symptom/movement triggers.
 *
 * Pure modules only — no database, no UI, no network. Run with:
 *
 *   npx tsc tests/epic4_5_4_7.test.ts src/composer/intent.ts \
 *     src/onboarding/dates.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests-457 --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-457/tests/epic4_5_4_7.test.js
 */

import { detectIntents } from '../src/composer/intent';
import { todayISO } from '../src/onboarding/dates';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function kinds(text: string): string[] {
  return detectIntents(text).map((p) => p.kind);
}

// ---- Epic 4.5: appointment occurredAt handling ----

{
  const [p] = detectIntents('OB appointment next Tuesday');
  check('appt proposal kind', p.kind, 'appointment');
  // Untouched picker → default to today (not undefined, not "now" drift).
  const built = p.buildEvent('see you then');
  check('appt default occurredAt = today', built.occurredAt, todayISO());
  check('appt type', built.type, 'appointment');
  check(
    'appt data shape',
    built.data,
    { title: 'Appointment', note: 'see you then' },
  );
}

{
  // Future date from the picker is honored verbatim (future allowed).
  const [p] = detectIntents('checkup next month');
  const future = '2026-11-04';
  const built = p.buildEvent('questions list', { occurredAt: future });
  check('appt future occurredAt honored', built.occurredAt, future);
}

{
  // Past dates are allowed too (logging the visit afterwards).
  const [p] = detectIntents('midwife visit');
  const past = '2026-08-30';
  const built = p.buildEvent('went well', { occurredAt: past });
  check('appt past occurredAt honored', built.occurredAt, past);
}

// ---- Epic 4.7: milestone triggers ----

const milestoneCases: Array<[string, string]> = [
  ['heard the heartbeat at my visit', 'First heartbeat'],
  ['first heartbeat today!', 'First heartbeat'],
  ['saw the baby on the screen', 'Saw the baby'],
  ['we saw the baby today', 'Saw the baby'],
  ['picked a name — Wren!', 'Picked a name'],
  ['we chose a name', 'Picked a name'],
  ['decided on a name finally', 'Picked a name'],
  ['named the baby after my grandma', 'Picked a name'],
  ['painting the nursery this weekend', 'Nursery progress'],
  ['nursery is almost ready', 'Nursery progress'],
  ['packed the hospital bag', 'Hospital bag packed'],
  ['hospital bag is packed', 'Hospital bag packed'],
];

for (const [text, title] of milestoneCases) {
  const found = detectIntents(text);
  check(`milestone kind: "${text}"`, found.map((p) => p.kind), ['milestone']);
  check(`milestone title: "${text}"`, found[0].labels, [title]);
  const ev = found[0].buildEvent('my note');
  check(`milestone event type: "${text}"`, ev.type, 'milestone');
  check(
    `milestone event data: "${text}"`,
    ev.data,
    { title, note: 'my note' },
  );
  check(
    `milestone event has no occurredAt: "${text}"`,
    'occurredAt' in ev,
    false,
  );
}

// ---- No-conflict cases ----

// Appointment texts must NOT shadow a milestone proposal.
const appointmentOnly = [
  'my ultrasound appointment is Tuesday',
  'scan appointment tomorrow morning',
  'checkup with the midwife next week',
  'doctor visit on Friday',
  'ob visit — bring questions',
];
for (const text of appointmentOnly) {
  const k = kinds(text);
  check(`appointment-only: "${text}"`, k.includes('milestone'), false);
  check(`appointment fires: "${text}"`, k.includes('appointment'), true);
}

// Symptom texts must NOT shadow a milestone proposal.
const symptomOnly = ['heartburn after lunch', 'so tired and nauseous today'];
for (const text of symptomOnly) {
  check(`symptom-only: "${text}"`, kinds(text).includes('milestone'), false);
}

// Movement milestone still works on its own and coexists cleanly.
{
  const found = detectIntents('baby kicking like crazy');
  check('movement proposal kind', found.map((p) => p.kind), ['movement']);
  check('movement milestone title', found[0].labels, ['Baby on the move']);
  check('movement builds milestone event', found[0].buildEvent('x').type, 'milestone');
}

// A genuinely dual text (celebration + appointment words) may propose
// both — she picks. Nothing else should sneak in.
{
  const found = detectIntents('heard the heartbeat at my ultrasound appointment');
  const k = found.map((p) => p.kind);
  check('dual text proposes milestone', k.includes('milestone'), true);
  check('dual text proposes appointment', k.includes('appointment'), true);
  check('dual text proposes nothing else', k.length, 2);
}

console.log(`\nepic4_5_4_7: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
