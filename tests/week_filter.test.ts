/**
 * Week-filter + display-week tests (Phase 2, Sept 2026; display-week
 * contract, Anuraj Sept 2026).
 *
 * Locked rule: LMP = EDD − 280 days; completedWeeks = floor((day − LMP) / 7);
 * DISPLAYED week = completed + 1. Internal grouping and filter matching
 * stay on completed-week numbers (pregnancyWeekForEvent / buildSections
 * keys); every user-facing label — the pill, the dropdown options, the
 * divider bands — shows the display week. Due 2026-10-08: Sep 19 is
 * completed 37, DISPLAYED Week 38, everywhere.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/week_filter.test.ts src/timeline/timeline.ts \
 *     src/onboarding/dates.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests-wf --module commonjs --target es2022 --skipLibCheck --esModuleInterop
 *   env TZ=UTC node /tmp/nurture-tests-wf/tests/week_filter.test.js
 */

import {
  buildSections,
  currentDisplayWeek,
  currentPregnancyWeek,
  displayWeekLabel,
  pregnancyWeekForEvent,
} from '../src/timeline/timeline';
import { displayWeek, weekOf } from '../src/onboarding/dates';
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

// Internals stay on completed weeks.
check('currentPregnancyWeek: the reported bug date is completed 37', currentPregnancyWeek(DUE, '2026-09-19'), 37);
check('weekOf: completed-weeks convention is 37', weekOf(DUE, '2026-09-19')?.week, 37);

// The locked rule: display = completed + 1.
check('displayWeek: Sep 19 reads Week 38', displayWeek(DUE, '2026-09-19'), 38);
check('currentDisplayWeek: the pill reads Week 38', currentDisplayWeek(DUE, '2026-09-19'), 38);

// Unification invariant: the pill's display week always equals the divider
// label for an event that occurred on the same day — swept across
// completed weeks 30..41.
for (let w = 30; w <= 41; w += 1) {
  // LMP = due - 280d = 2026-01-01; completed week w starts LMP + 7*w.
  const lmp = Date.UTC(2026, 0, 1);
  const day = new Date(lmp + 7 * w * 86400000);
  const iso = day.toISOString().slice(0, 10);
  const sections = buildSections(
    [
      {
        id: 'x',
        type: 'note',
        occurredAt: `${iso}T12:00:00.000Z`,
        createdAt: `${iso}T12:00:00.000Z`,
        data: {},
      } as unknown as LocalEvent,
    ],
    DUE,
  );
  check(
    `pill/divider agreement on ${iso} (completed ${w})`,
    sections[0]?.title,
    `Week ${currentDisplayWeek(DUE, iso)}`,
  );
}
check('unified display week 29 spot value', currentDisplayWeek(DUE, '2026-07-23'), 30);
check('displayWeekLabel formats completed numbers', displayWeekLabel(37), 'Week 38');

// Guards (completed-week behavior is unchanged).
check('null when dates do not parse', currentPregnancyWeek('not-a-date', '2026-09-19'), null);
check('null before the pregnancy begins', currentPregnancyWeek(DUE, '2025-12-20'), null);
check('clamps to week 1 right after LMP', currentPregnancyWeek(DUE, '2026-01-01'), 1);
check('clamps to week 42 far past the due date', currentPregnancyWeek(DUE, '2027-06-01'), 42);
check('display null before the pregnancy begins', currentDisplayWeek(DUE, '2025-12-20'), null);

// Filter semantics: events grouped by completed-week band internally;
// selecting one week keeps only that week's divider + entries, and the
// divider label shows the DISPLAY week (mirrors the app's applyFilters +
// buildSections path).
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
  fakeEvent('e0', 0), // Sep 19 -> completed 37 -> "Week 38"
  fakeEvent('e8', 8), // Sep 11 -> completed 36 -> "Week 37"
  fakeEvent('e16', 16), // Sep 3 -> completed 35 -> "Week 36"
  fakeEvent('e28', 28), // Aug 22 -> completed 33 -> "Week 34"
];
const weekOfEvent = (e: LocalEvent) => pregnancyWeekForEvent(DUE, e.occurredAt);
check('band keys stay on completed weeks', events.map(weekOfEvent), [37, 36, 35, 33]);

const filtered36 = events.filter((e) => weekOfEvent(e) === 36);
const sections36 = buildSections(filtered36, DUE);
check('filtering to completed 36 yields one divider', sections36.map((s) => s.title), ['Week 37']);
check('filtering to completed 36 yields one entry', sections36[0]!.data.map((e) => e.id), ['e8']);

const sectionsAll = buildSections(events, DUE);
check('all weeks yields four dividers with display labels', sectionsAll.map((s) => s.title),
  ['Week 38', 'Week 37', 'Week 36', 'Week 34']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
