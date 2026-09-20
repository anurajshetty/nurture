/**
 * Display-week regression tests (Anuraj, Sept 2026).
 *
 * Locked rule: LMP = EDD − 280 days; completedWeeks = floor((day − LMP) / 7);
 * DISPLAYED week = completed + 1. There is exactly ONE display-week helper —
 * displayWeek() in src/onboarding/dates — and the Logs/Week surfaces show
 * it via the display wrappers in src/timeline/timeline.ts
 * (displayWeekForDay, currentDisplayWeek, displayWeekLabel). Internal
 * grouping, ranges, and content lookups stay on the completed-week
 * helpers (pregnancyWeek, pregnancyWeekForDay, pregnancyWeekRange).
 *
 * Canonical regression: due 2026-10-08 (LMP 2026-01-01) →
 * 2026-09-19 = completed 37 = DISPLAYED Week 38.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/week_logic_shared.test.ts src/onboarding/dates.ts \
 *     src/timeline/timeline.ts src/week/content.ts src/briefing/context.ts \
 *     src/briefing/matrix.ts src/briefing/delight.ts src/theme/tokens.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests-ws --module commonjs --target es2022 --skipLibCheck --esModuleInterop
 *   env TZ=UTC node /tmp/nurture-tests-ws/tests/week_logic_shared.test.js
 */

import { displayWeek, pregnancyWeek } from '../src/onboarding/dates';
import {
  currentDisplayWeek,
  currentPregnancyWeek,
  displayWeekForDay,
  displayWeekLabel,
  pregnancyWeekForDay,
  pregnancyWeekForEvent,
  pregnancyWeekRange,
} from '../src/timeline/timeline';

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

const DUE = '2026-10-08'; // LMP 2026-01-01 (Thursday)

/* ---------------- the canonical regression ---------------- */

check('completed side is unchanged: Sep 19 is completed 37', pregnancyWeek(DUE, '2026-09-19'), 37);
check('THE case: Sep 19 displays Week 38', displayWeek(DUE, '2026-09-19'), 38);
check('Sep 17 (completed 37) displays Week 38', displayWeek(DUE, '2026-09-17'), 38);
check('Sep 23 (completed 37) displays Week 38', displayWeek(DUE, '2026-09-23'), 38);
check('Sep 24 (completed 38) displays Week 39', displayWeek(DUE, '2026-09-24'), 39);
check('Sep 16 (completed 36) displays Week 37', displayWeek(DUE, '2026-09-16'), 37);
check('LMP day (completed 0) displays Week 1', displayWeek(DUE, '2026-01-01'), 1);
// The timeline's banding guard clamps pre-LMP/completed-0 days to band 1
// so every card lands somewhere; that band's LABEL is completed + 1.
check('clamped band-1 label is Week 2', displayWeekForDay(DUE, '2026-01-01'), 2);
check('due date (completed 40) displays Week 41', displayWeek(DUE, '2026-10-08'), 41);

/* ---------------- bad input ---------------- */

check('null on garbage due date', displayWeek('not-a-date', '2026-09-17'), null);
check('null on garbage asOf', displayWeek(DUE, 'nope'), null);
check('null on impossible date', displayWeek(DUE, '2026-02-30'), null);
check('null on empty due date', displayWeek('', '2026-09-17'), null);
check('null before the pregnancy begins', displayWeek(DUE, '2025-12-20'), null);

/* ---------------- the display wrappers all read displayWeek ---------------- */

check('displayWeekForDay agrees (completed 37 -> 38)', displayWeekForDay(DUE, '2026-09-19'), 38);
check('currentDisplayWeek agrees', currentDisplayWeek(DUE, '2026-09-19'), 38);
check('displayWeekLabel formats a completed number', displayWeekLabel(37), 'Week 38');
check('displayWeekLabel formats band 1', displayWeekLabel(1), 'Week 2');

// Sweep the supported range: every display call site reads completed + 1
// on every day of completed weeks 1..41 (where no band-clamp kicks in).
{
  const lmp = Date.UTC(2026, 0, 1);
  let mismatches = 0;
  for (let dayOffset = 7; dayOffset <= 287; dayOffset += 1) {
    const iso = new Date(lmp + dayOffset * 86400000).toISOString().slice(0, 10);
    const completed = pregnancyWeekForDay(DUE, iso)!;
    const expected = completed + 1;
    const nums = [
      displayWeek(DUE, iso),
      displayWeekForDay(DUE, iso),
      currentDisplayWeek(DUE, iso),
    ];
    if (
      !nums.every((g) => g === expected) ||
      displayWeekLabel(completed) !== `Week ${expected}`
    ) {
      mismatches += 1;
      if (mismatches === 1) console.error(`first mismatch at ${iso}`);
    }
  }
  check('all display call sites read completed + 1 on every day of weeks 1..41', mismatches, 0);
}

// Pill/divider agreement: the divider label for an event that occurred
// today always equals the pill's display week.
{
  const lmp = Date.UTC(2026, 0, 1);
  let mismatches = 0;
  for (let dayOffset = 0; dayOffset <= 287; dayOffset += 1) {
    const iso = new Date(lmp + dayOffset * 86400000).toISOString().slice(0, 10);
    const pill = currentDisplayWeek(DUE, iso);
    const divider = displayWeekForDay(DUE, iso);
    if (pill !== divider) {
      mismatches += 1;
      if (mismatches === 1) console.error(`first pill/divider mismatch at ${iso}: ${pill} vs ${divider}`);
    }
  }
  check('pill display week always equals divider display week', mismatches, 0);
}

/* ---------------- internals stay on completed weeks ---------------- */

check('currentPregnancyWeek stays completed', currentPregnancyWeek(DUE, '2026-09-19'), 37);
check('pregnancyWeekForDay stays completed', pregnancyWeekForDay(DUE, '2026-09-19'), 37);
check('pregnancyWeekForEvent stays completed', pregnancyWeekForEvent(DUE, '2026-09-19T12:00:00.000Z'), 37);
check('week 37 range still starts Sep 17 (completed indexing)', pregnancyWeekRange(37, DUE), {
  startISO: '2026-09-17',
  endISO: '2026-09-24',
});
check('clamps to completed week 1 right after LMP', currentPregnancyWeek(DUE, '2026-01-01'), 1);
check('clamps to completed week 42 far past the due date', currentPregnancyWeek(DUE, '2027-06-01'), 42);
check('null when dates do not parse', currentPregnancyWeek('not-a-date', '2026-09-19'), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
