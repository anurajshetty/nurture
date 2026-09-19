/**
 * Track 3 tests: anonymized briefing context (src/briefing/context.ts).
 *
 * Pure core only — `buildBriefingContextFrom(deps)` takes every input as
 * arguments, so these tests never touch Expo, SQLite, or the network. Run with:
 *
 *   npx tsc tests/briefing_context.test.ts src/briefing/context.ts \
 *     src/onboarding/dates.ts src/lib/types.ts src/logging/symptoms.ts \
 *     --outDir /tmp/nurture-tests-brief --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   TZ=UTC node /tmp/nurture-tests-brief/tests/briefing_context.test.js
 *
 * TZ=UTC keeps date math deterministic across machines.
 */

import {
  AGE_BAND_KV_KEY,
  AGE_BAND_OPTIONS,
  buildBriefingContextFrom,
  type BriefingContext,
  type BriefingDeps,
} from '../src/briefing/context';
import { addDaysISO } from '../src/onboarding/dates';
import type { LocalEvent } from '../src/lib/types';

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

const TODAY = '2026-09-18';

/** due date that yields exactly `gestationalDays` on TODAY. */
function dueFor(gestationalDays: number): string {
  const due = addDaysISO(TODAY, 280 - gestationalDays);
  if (!due) throw new Error('bad test date');
  return due;
}

function mkSymptomEvent(symptoms: unknown[], occurredAt = `${TODAY}T10:00:00.000Z`): BriefingDeps['symptomEvents'][number] {
  return { type: 'symptom', occurredAt, data: { symptoms } };
}

function baseDeps(): BriefingDeps {
  return {
    pregnancy: { dueDate: dueFor(180), parity: 'first' }, // week 25, day 6
    ageBand: null,
    symptomEvents: [],
    today: TODAY,
  };
}

/* ---------------- week/day math ---------------- */

check('week/day from due date (g=180 → week 25 day 6)', buildBriefingContextFrom(baseDeps()), {
  week: 25,
  day: 6,
  firstTimeMom: true,
  symptomThemes: [],
});

check('null when no pregnancy', buildBriefingContextFrom({ ...baseDeps(), pregnancy: null }), null);
check(
  'null when no due date',
  buildBriefingContextFrom({ ...baseDeps(), pregnancy: { dueDate: null, parity: 'first' } }),
  null,
);

check('day 1..7 boundary: g=28 → week 4 day 1', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(28), parity: 'first' },
}), { week: 4, day: 1, firstTimeMom: true, symptomThemes: [] });

check('day 1..7 boundary: g=34 → week 4 day 7', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(34), parity: 'first' },
}), { week: 4, day: 7, firstTimeMom: true, symptomThemes: [] });

check('week 42 boundary: g=294 → week 42 day 1', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(294), parity: 'first' },
})?.week, 42);

check('null below contract window (g=20 → week 2)', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(20), parity: 'first' },
}), null);

check('null above contract window (g=301 → week 43)', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(301), parity: 'first' },
}), null);

check('null when due date is in the past (g>280 but week<42 still fine)', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(281), parity: 'first' },
})?.week, 40);

check('firstTimeMom false for subsequent parity', buildBriefingContextFrom({
  ...baseDeps(),
  pregnancy: { dueDate: dueFor(180), parity: 'subsequent' },
})?.firstTimeMom, false);

/* ---------------- age band ---------------- */

check(
  'ageBand passes through when canonical',
  buildBriefingContextFrom({ ...baseDeps(), ageBand: '30-34' })?.ageBand,
  '30-34',
);
check(
  'ageBand omitted when unset',
  'ageBand' in (buildBriefingContextFrom(baseDeps()) as BriefingContext),
  false,
);
check(
  'non-canonical ageBand is dropped, not fatal',
  buildBriefingContextFrom({ ...baseDeps(), ageBand: '30' }),
  { week: 25, day: 6, firstTimeMom: true, symptomThemes: [] },
);
check('age band kv key name', AGE_BAND_KV_KEY, 'briefing.ageBand');
check(
  'five age band options',
  AGE_BAND_OPTIONS.map((o) => o.value),
  ['under-25', '25-29', '30-34', '35-39', '40-plus'],
);

/* ---------------- symptom themes ---------------- */

check(
  'distinct canonical labels, most-recent first',
  buildBriefingContextFrom({
    ...baseDeps(),
    symptomEvents: [
      mkSymptomEvent(['Insomnia', 'Backache'], `${TODAY}T12:00:00.000Z`),
      mkSymptomEvent(['Nausea', 'backache'], '2026-09-17T09:00:00.000Z'),
    ],
  })?.symptomThemes,
  ['insomnia', 'backache', 'nausea'],
);

check(
  'free-text custom entries are dropped — no free text leaves the device',
  buildBriefingContextFrom({
    ...baseDeps(),
    symptomEvents: [mkSymptomEvent(['Backache', 'weird cramp after dinner lol'])],
  })?.symptomThemes,
  ['backache'],
);

check(
  'max 5 themes',
  buildBriefingContextFrom({
    ...baseDeps(),
    symptomEvents: [
      mkSymptomEvent(['Nausea', 'Vomiting', 'Fatigue', 'Headache', 'Backache', 'Heartburn', 'Swelling']),
    ],
  })?.symptomThemes,
  ['nausea', 'vomiting', 'fatigue', 'headache', 'backache'],
);

check(
  'non-symptom events ignored',
  buildBriefingContextFrom({
    ...baseDeps(),
    symptomEvents: [
      { type: 'note', occurredAt: `${TODAY}T10:00:00.000Z`, data: { text: 'felt great' } },
      mkSymptomEvent(['Fatigue']),
    ],
  })?.symptomThemes,
  ['fatigue'],
);

check(
  'malformed symptom payloads ignored',
  buildBriefingContextFrom({
    ...baseDeps(),
    symptomEvents: [
      mkSymptomEvent('not-an-array' as unknown as unknown[]),
      { type: 'symptom', occurredAt: `${TODAY}T10:00:00.000Z`, data: {} },
      mkSymptomEvent([42, null, 'Dizziness'] as unknown as unknown[]),
    ],
  })?.symptomThemes,
  ['dizziness'],
);

/* ---------------- anonymization invariants ---------------- */

const full = buildBriefingContextFrom({
  pregnancy: { dueDate: dueFor(180), parity: 'first' },
  ageBand: '25-29',
  symptomEvents: [mkSymptomEvent(['Backache'])],
  today: TODAY,
}) as BriefingContext;

const ALLOWED_KEYS = ['week', 'day', 'firstTimeMom', 'ageBand', 'symptomThemes'];
check(
  'output keys are exactly the anonymized set',
  Object.keys(full).sort(),
  ALLOWED_KEYS.filter((k) => k !== 'ageBand' || full.ageBand !== undefined).sort(),
);

const serialized = JSON.stringify(full);
check('no due date in output', serialized.includes(dueFor(180)), false);
check('no identifiers in output', /userId|email|@|pregnancyId|note|photo|file/i.test(serialized), false);
check(
  'themes carry no free text',
  (full.symptomThemes as string[]).every((t) => /^[a-z ]+$/.test(t)),
  true,
);

/* ---------------- summary ---------------- */

console.log(`\nbriefing_context: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
