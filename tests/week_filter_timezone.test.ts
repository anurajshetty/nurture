/**
 * Week-pill filter vs device-local day regression (Anuraj caught live on
 * his iPhone, Sept 2026): selecting the latest week pill showed an EMPTY
 * feed while "All weeks" showed the entries.
 *
 * Root cause: pregnancyWeekForEvent() derived the entry's week from the
 * UTC date part of the ISO timestamp (occurredAt.slice(0, 10)), while day
 * grouping (localDayISO) and the current-week pill (todayISO) use the
 * DEVICE-LOCAL calendar day. An entry logged at 11:30 PM local time is
 * already the next UTC day; on the night before a pregnancy-week
 * boundary the UTC slice lands in the NEXT week, so the entry vanished
 * from the week-filtered feed (but stayed visible under "All weeks").
 *
 * The fix: pregnancyWeekForEvent() uses the device-local calendar day.
 *
 * This test MUST run under a negative-offset zone (America/Los_Angeles):
 * only there does 11:30 PM local fall on the next UTC day, which is what
 * makes it fail without the fix. Due 2026-10-13 puts a week boundary on
 * 2026-09-22, so a Sep-21-evening entry is the discriminating case.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/week_filter_timezone.test.ts src/timeline/timeline.ts \
 *     src/onboarding/dates.ts --outDir /tmp/nurture-tests-wftz --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   env TZ=America/Los_Angeles node /tmp/nurture-tests-wftz/tests/week_filter_timezone.test.js
 */

import {
  buildDaySections,
  currentPregnancyWeek,
  displayWeekLabel,
  localDayISO,
  pregnancyWeekForEvent,
  storyDateOf,
} from '../src/timeline/timeline';
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

// Due 2026-10-13: completed week 37 starts 2026-09-22, so 2026-09-21 is
// completed week 36 (the "current week" pill reads "Week 37").
const DUE = '2026-10-13';
const TODAY = '2026-09-21';

function moodEvent(id: string, localWall: Date): LocalEvent {
  const iso = localWall.toISOString();
  return {
    id,
    type: 'mood',
    occurredAt: iso,
    createdAt: iso,
    data: { mood: 'calm' },
  } as unknown as LocalEvent;
}

// 11:30 PM device-local on Sep 21 — already Sep 22 in UTC.
const evening = moodEvent('evening', new Date(2026, 8, 21, 23, 30, 0));
// 9:00 AM device-local on Sep 21 — same UTC calendar day (control case).
const morning = moodEvent('morning', new Date(2026, 8, 21, 9, 0, 0));

// Sanity: the wall-clock setup really straddles the UTC midnight line.
check('evening entry is Sep 22 in UTC', evening.createdAt.slice(0, 10), '2026-09-22');
check('evening entry is Sep 21 device-local', localDayISO(storyDateOf(evening)), '2026-09-21');

// The pill's filter value for "today".
const pillWeek = currentPregnancyWeek(DUE, TODAY);
check('pill filter value is completed week 36', pillWeek, 36);
check('pill label reads Week 37', pillWeek === null ? null : displayWeekLabel(pillWeek), 'Week 37');

// THE regression: the evening entry must match the pill's week.
// Without the fix this is 37 (UTC Sep 22) !== 36 → the entry vanishes.
check(
  'evening entry matches the pill week (device-local)',
  pregnancyWeekForEvent(DUE, storyDateOf(evening)),
  pillWeek,
);
check(
  'morning entry matches the pill week',
  pregnancyWeekForEvent(DUE, storyDateOf(morning)),
  pillWeek,
);

// Visible outcome, end to end: the app's applyFilters keeps an entry
// under a selected week iff pregnancyWeekForEvent(storyDateOf) equals it.
// Everything visible under "All weeks" must also appear under the pill
// for the week containing its local day.
function applyWeekFilter(list: LocalEvent[], weekFilter: 'all' | number): LocalEvent[] {
  if (weekFilter === 'all') return [...list];
  return list.filter((e) => pregnancyWeekForEvent(DUE, storyDateOf(e)) === weekFilter);
}

const events = [evening, morning];
check('all-weeks shows both entries', applyWeekFilter(events, 'all').map((e) => e.id), ['evening', 'morning']);
check(
  'pill week shows both entries (was: evening entry missing)',
  applyWeekFilter(events, 36).map((e) => e.id),
  ['evening', 'morning'],
);

// Day grouping agrees: the evening entry sits under local Sep 21 ("Today").
const sections = buildDaySections(events, TODAY);
check('one day section', sections.length, 1);
check('evening entry grouped under local Sep 21', sections[0]?.key, 'day-2026-09-21');
check('section labeled Today', sections[0]?.title, 'Today');
check(
  'section holds both entries',
  (sections[0]?.data ?? []).map((e) => (e as LocalEvent).id).sort(),
  ['evening', 'morning'],
);

console.log(`week_filter_timezone: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
