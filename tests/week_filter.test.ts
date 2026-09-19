/**
 * Week-filter unification tests (Phase 2, Sept 2026).
 *
 * The reported bug: with due date 2026-10-08 the Logs week pill showed
 * "Week 37" (weekOf's 0-based completed weeks) while the top divider
 * showed "Week 38 · Sep 17–23" (pregnancyWeekForEvent's 1-based week).
 * The pill now uses currentPregnancyWeek — the same 1-based number the
 * dividers use — and the dropdown is a filter (selected week shows only
 * that week's divider + entries; 'all' shows everything).
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/week_filter.test.ts src/timeline/timeline.ts src/onboarding/dates.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests-wf --module commonjs --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-wf/tests/week_filter.test.js
 */

import {
  buildSections,
  currentPregnancyWeek,
  pregnancyWeekForEvent,
} from '../src/timeline/timeline';
import { weekOf } from '../src/onboarding/dates';
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

const DUE = '2026-10-08';
// The exact reported scenario: on Sep 19 the pill said Week 37 while the
// top divider said Week 38 (Sep 17–23).
check('currentPregnancyWeek: the reported bug date is Week 38', currentPregnancyWeek(DUE, '2026-09-19'), 38);
check('weekOf: completed-weeks convention is 37 (the old pill value)', weekOf(DUE, '2026-09-19')?.week, 37);

// Unification invariant: the pill's week always equals the divider week
// for an event that occurred on the same day — swept across weeks 30..41.
for (let w = 30; w <= 41; w += 1) {
  // LMP = due - 280d = 2026-01-01; day 0 of week w = LMP + 7*(w-1).
  const lmp = Date.UTC(2026, 0, 1);
  const day = new Date(lmp + 7 * (w - 1) * 86400000);
  const iso = day.toISOString().slice(0, 10);
  check(
    `unified week for ${iso} (week ${w})`,
    currentPregnancyWeek(DUE, iso),
    pregnancyWeekForEvent(DUE, `${iso}T12:00:00`),
  );
}
check('unified week 30 spot value', currentPregnancyWeek(DUE, '2026-07-23'), 30);

// Guards.
check('null when dates do not parse', currentPregnancyWeek('not-a-date', '2026-09-19'), null);
check('null before the pregnancy begins', currentPregnancyWeek(DUE, '2025-12-20'), null);
check('clamps to week 1 right after LMP', currentPregnancyWeek(DUE, '2026-01-01'), 1);
check('clamps to week 42 far past the due date', currentPregnancyWeek(DUE, '2027-06-01'), 42);

// Filter semantics: events grouped by divider week; selecting one week
// keeps only that week's divider + entries (mirrors the app's
// applyFilters + buildSections path).
function fakeEvent(id: string, daysAgo: number): LocalEvent {
  const t = Date.UTC(2026, 8, 19) - daysAgo * 86400000;
  return {
    id,
    type: 'note',
    occurredAt: new Date(t).toISOString(),
    createdAt: new Date(t).toISOString(),
    data: { text: id },
  } as unknown as LocalEvent;
}

const events = [
  fakeEvent('e0', 0), // Sep 19 -> Week 38
  fakeEvent('e8', 8), // Sep 11 -> Week 37
  fakeEvent('e16', 16), // Sep 3 -> Week 36
  fakeEvent('e28', 28), // Aug 22 -> Week 34
];
const weekOfEvent = (e: LocalEvent) => pregnancyWeekForEvent(DUE, e.occurredAt);
check('divider weeks', events.map(weekOfEvent), [38, 37, 36, 34]);

const filtered37 = events.filter((e) => weekOfEvent(e) === 37);
const sections37 = buildSections(filtered37, DUE);
check('filtering to Week 37 yields one divider', sections37.map((s) => s.title), ['Week 37']);
check('filtering to Week 37 yields one entry', sections37[0]!.data.map((e) => e.id), ['e8']);

const sectionsAll = buildSections(events, DUE);
check('all weeks yields four dividers', sectionsAll.map((s) => s.title),
  ['Week 38', 'Week 37', 'Week 36', 'Week 34']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
