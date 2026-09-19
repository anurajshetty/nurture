/**
 * Epic 5 tests: Week view content assembly (src/week/content.ts) — pure,
 * no native modules, no network.
 *
 * Run with:
 *   npx tsc tests/week_content.test.ts src/week/content.ts \
 *     src/briefing/matrix.ts src/briefing/delight.ts src/briefing/context.ts \
 *     src/briefing/types.ts src/theme/tokens.ts src/lib/types.ts \
 *     src/onboarding/dates.ts \
 *     --outDir /tmp/nurture-tests-week --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-week/tests/week_content.test.js
 */

import {
  MAX_WEEK,
  MIN_WEEK,
  getWeekContent,
  getWeekNumber,
  getWeekQuestions,
  getWeekRangeLabel,
  resolveNameTokens,
  shouldShowWeekContent,
  weekGreeting,
} from '../src/week/content';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function eq<T>(a: T, b: T, name: string): void {
  ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// Due 2026-10-08. On 2026-09-19 that's 19 days out → 261 gestational days
// → week 37 (floor(261/7) = 37), day 3.
const DUE = '2026-10-08';
const TODAY = '2026-09-19';

// --- getWeekNumber ----------------------------------------------------

eq(getWeekNumber(DUE, TODAY), 37, 'week number for 2026-09-19');
eq(getWeekNumber(null, TODAY), null, 'null due date → null');
eq(getWeekNumber('', TODAY), null, 'empty due date → null');
eq(getWeekNumber('not-a-date', TODAY), null, 'bad due date → null');
// Week 3 (too early) → null; use a due date 277 days out → g=3 → week 0
eq(getWeekNumber('2027-06-23', TODAY), null, 'week < 4 → null');
// Far past due: g<0 → null (due more than 280 days before today)
eq(getWeekNumber('2025-01-01', TODAY), null, 'due >280d ago (g<0) → null');
eq(getWeekNumber(DUE, '2026-03-08'), 9, 'early pregnancy week 9');
ok(
  getWeekNumber(DUE, '2026-10-08') === 40,
  'due date itself → week 40',
);
eq(getWeekNumber(DUE, '2026-10-15'), 41, 'one week past due → week 41');
eq(getWeekNumber(DUE, '2026-10-29'), null, 'three weeks past due (43) → null');

// --- getWeekContent: curated week --------------------------------------

const c37 = getWeekContent(37, DUE, TODAY);
eq(c37.week, 37, 'content week');
ok(c37.size !== null, 'week 37 has a size entry');
eq(c37.size?.staple, 'a bundle of leeks', 'week 37 size staple');
eq(c37.highlights.length, 3, 'exactly 3 highlights');
ok(
  c37.highlights.every((h) => h.length > 0),
  'highlights non-empty',
);
eq(c37.readings.length, 2, '2 reading sections');
eq(c37.readings[0].title, 'Your body this week', 'reading 1 title');
eq(c37.readings[1].title, 'Tips for this week', 'reading 2 title');
ok(
  c37.readings.every((r) => r.body.length > 0),
  'readings have body paragraphs',
);
ok(
  c37.readings.every((r) => /min read/.test(r.subtitle)),
  'readings carry read-time subtitles',
);
ok(
  c37.readings.every((r) => /Available offline/.test(r.subtitle)),
  'readings marked available offline',
);
eq(c37.questions.length, 2, '2 care-team questions');
ok(
  c37.questions.every((q) => q.length > 0),
  'questions non-empty',
);
eq(c37.weeksToGo, 3, 'weeks to go from 37');
ok(
  typeof c37.weekRange === 'string' && c37.weekRange.length > 0,
  'week range label present',
);

// --- getWeekContent: fallback week -------------------------------------

const c20 = getWeekContent(20, '2027-02-10', '2026-09-19');
eq(c20.week, 20, 'fallback content week');
ok(c20.size !== null, 'week 20 has a size entry (banana)');
eq(c20.size?.staple, 'a banana', 'week 20 size staple');
eq(c20.highlights.length, 3, 'fallback: 3 highlights');
eq(c20.readings.length, 2, 'fallback: 2 readings');
eq(c20.questions.length, 2, 'fallback: 2 questions');

// --- getWeekContent: size coverage edges --------------------------------

const c4 = getWeekContent(4, '2027-06-01', '2026-09-19');
eq(c4.size, null, 'week 4: no size entry (starts at 12)');
const c41 = getWeekContent(41, DUE, '2026-10-22');
eq(c41.size, null, 'week 41: no size entry (ends at 40)');
ok(c41.highlights.length === 3, 'week 41 curated highlights present');

// --- questions ----------------------------------------------------------

const q36 = getWeekQuestions(36);
eq(q36.length, 2, 'curated week 36: 2 questions');
const q20 = getWeekQuestions(20);
eq(q20.length, 2, 'fallback week: 2 questions');
ok(
  !q20.some((q) => /should|must|never/i.test(q)),
  'fallback questions are prompts, not advice',
);

// --- week range label ----------------------------------------------------

const range = getWeekRangeLabel(DUE, TODAY);
ok(range !== null && /–/.test(range as string), `range label: ${range}`);
eq(getWeekRangeLabel('bad', TODAY), null, 'bad due → null range');
eq(getWeekRangeLabel(DUE, 'bad'), null, 'bad today → null range');

// --- loss-mode halt -------------------------------------------------------

ok(
  shouldShowWeekContent({ status: 'active' }) === true,
  'active pregnancy → show content',
);
ok(
  shouldShowWeekContent({ status: 'stopped' }) === false,
  'stopped pregnancy → halt content',
);
ok(shouldShowWeekContent(null) === false, 'null pregnancy → halt content');

// --- content safety scan ---------------------------------------------------
// General-info posture: no prescriptive or alarming language anywhere in
// the assembled copy for every week 4–42.

const BANNED = [
  /you should/i,
  /you must/i,
  /you shouldn't/i,
  /never do/i,
  /warning sign/i,
  /\d+\s*%/,
  /risk of/i,
  /clinician-reviewed/i,
  /reviewed by/i,
];

let scanned = 0;
for (let w = MIN_WEEK; w <= MAX_WEEK; w++) {
  const c = getWeekContent(w, DUE, TODAY);
  const texts = [
    ...c.highlights,
    ...c.readings.flatMap((r) => [r.title, ...r.body]),
    ...c.questions,
  ];
  for (const t of texts) {
    scanned++;
    for (const rx of BANNED) {
      ok(!rx.test(t), `week ${w}: banned pattern ${rx} in ${JSON.stringify(t).slice(0, 80)}`);
    }
  }
}
ok(scanned > 0, `safety-scanned ${scanned} copy blocks`);

// --- bounds ---------------------------------------------------------------

eq(MIN_WEEK, 4, 'MIN_WEEK');
eq(MAX_WEEK, 42, 'MAX_WEEK');

// --- name tokens ----------------------------------------------------------
eq(
  resolveNameTokens('{Name} is gaining fast', 'Wren'),
  'Wren is gaining fast',
  'capital token uses the saved name',
);
eq(
  resolveNameTokens("Early term — {name}'s organs are ready", 'Wren'),
  "Early term — Wren's organs are ready",
  'lowercase token uses the saved name',
);
eq(
  resolveNameTokens('{Name} is growing', null),
  'Your baby is growing',
  'capital token falls back to "Your baby"',
);
eq(
  resolveNameTokens("{name}'s grip is strong", null),
  "your baby's grip is strong",
  'lowercase token falls back to "your baby"',
);
eq(
  resolveNameTokens('{Name} and {name}', '  '),
  'Your baby and your baby',
  'blank name counts as unset',
);

// Tokens resolve inside assembled Week content (no raw tokens leak).
{
  const named = getWeekContent(37, DUE, TODAY, 'Wren');
  const unnamed = getWeekContent(37, DUE, TODAY, null);
  const all = (c: ReturnType<typeof getWeekContent>) => [
    ...c.highlights,
    ...c.readings.flatMap((r) => r.body),
  ];
  ok(
    all(named).every((t) => !/\{(Name|name)\}/.test(t)),
    'named: no raw tokens in highlights/readings',
  );
  ok(
    all(unnamed).every((t) => !/\{(Name|name)\}/.test(t)),
    'unnamed: no raw tokens in highlights/readings',
  );
  ok(
    all(named).some((t) => t.includes('Wren')),
    'named: baby name appears in copy',
  );
  ok(
    all(unnamed).some((t) => /[Yy]our baby/.test(t)),
    'unnamed: generic "your baby" wording appears',
  );
}

// --- warm greeting ----------------------------------------------------------
eq(weekGreeting(8, 'Wren'), 'The beginning of everything, Wren.', 'greeting: early, named');
eq(weekGreeting(8, null), 'The beginning of everything.', 'greeting: early, unnamed');
eq(weekGreeting(20, 'Wren'), 'Look how far you and Wren have come.', 'greeting: middle, named');
eq(weekGreeting(20, null), `Look how far you've come.`, 'greeting: middle, unnamed');
eq(weekGreeting(30, 'Wren'), 'The home stretch. Wren is nearly here.', 'greeting: late, named');
eq(weekGreeting(30, null), 'The home stretch.', 'greeting: late, unnamed');
eq(weekGreeting(37, 'Wren'), `Hey, you're almost there. Any day now, Wren.`, 'greeting: 37+, named');
eq(weekGreeting(37, null), `Hey, you're almost there.`, 'greeting: 37+, unnamed');
eq(weekGreeting(42, null), `Hey, you're almost there.`, 'greeting: week 42');
{
  const bands: Array<[number, string | null]> = [
    [4, 'Wren'], [12, null], [13, 'Wren'], [27, null],
    [28, 'Wren'], [36, null], [37, 'Wren'], [42, null],
  ];
  ok(
    bands.every(([w, n]) => {
      const g = weekGreeting(w, n);
      return !/[;—]/.test(g) && !/\{(Name|name)\}/.test(g);
    }),
    'greeting: all bands, no semicolons/em dashes/tokens',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
