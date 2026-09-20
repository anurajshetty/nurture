/**
 * Epic 3.1 deterministic tests: timeline week-band grouping (src/timeline/timeline.ts).
 * Pure module only — no database, no Expo, no network. Run with:
 *
 *   npx tsc tests/epic3_timeline.test.ts src/timeline/timeline.ts \
 *     src/onboarding/dates.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests3 --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   TZ=UTC node /tmp/nurture-tests3/tests/epic3_timeline.test.js
 *
 * TZ=UTC keeps date math deterministic across machines.
 */

import {
  buildSections,
  formatDayShort,
  formatWeekRange,
  pregnancyWeekForEvent,
  pregnancyWeekRange,
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

function mkEvent(id: string, occurredAt: string): LocalEvent {
  return {
    id,
    userId: null,
    pregnancyId: null,
    type: 'note',
    occurredAt,
    visibility: 'private',
    data: {},
    idempotencyKey: id,
    deletedAt: null,
    updatedAt: occurredAt,
    dirty: false,
  };
}

// Sample due date: 2026-10-08 → LMP 2026-01-01 (280 days earlier).
const DUE = '2026-10-08';

// ---------- pregnancy week range ----------

{
  check('week 37 range', pregnancyWeekRange(37, DUE), {
    startISO: '2026-09-17',
    endISO: '2026-09-24',
  });
  check('week 1 starts 7 days after LMP', pregnancyWeekRange(1, DUE)?.startISO, '2026-01-08');
  check('week 0 invalid', pregnancyWeekRange(0, DUE), null);
  check('non-integer invalid', pregnancyWeekRange(24.5, DUE), null);
}

// ---------- week of an event ----------

{
  check('Sep 18 → week 37', pregnancyWeekForEvent(DUE, '2026-09-18T09:12:00.000Z'), 37);
  check('Sep 10 → week 36', pregnancyWeekForEvent(DUE, '2026-09-10T14:00:00.000Z'), 36);
  check('before week 1 clamps to 1', pregnancyWeekForEvent(DUE, '2025-06-01T00:00:00.000Z'), 1);
  check('past week 42 clamps to 42', pregnancyWeekForEvent(DUE, '2026-12-31T00:00:00.000Z'), 42);
}

// ---------- range / day labels ----------

{
  check('same month range', formatWeekRange('2026-09-17', '2026-09-24'), 'Sep 17 – 23');
  check('spanning months range', formatWeekRange('2026-08-31', '2026-09-07'), 'Aug 31 – Sep 6');
  check('day short', formatDayShort('2026-09-18'), 'Sep 18');
}

// ---------- buildSections: pregnancy week bands ----------

{
  const events = [
    mkEvent('c', '2026-09-10T14:00:00.000Z'), // week 36 — deliberately oldest-first
    mkEvent('a', '2026-09-18T09:12:00.000Z'), // week 37
    mkEvent('b', '2026-09-19T20:04:00.000Z'), // week 37
  ];
  const sections = buildSections(events, DUE);
  check('two week bands', sections.length, 2);
  check('newest band first', sections[0]?.key, 'preg-37');
  check('band title (display week = completed + 1)', sections[0]?.title, 'Week 38');
  check('band range subtitle', sections[0]?.subtitle, 'Sep 17 – 23');
  check('newest event first in band', sections[0]?.data.map((e) => e.id), ['b', 'a']);
  check('older band second', sections[1]?.key, 'preg-36');
  check('older band subtitle', sections[1]?.subtitle, 'Sep 10 – 16');
  check('older band contents', sections[1]?.data.map((e) => e.id), ['c']);
}

// ---------- buildSections: calendar-week fallback (no due date) ----------

{
  const events = [
    mkEvent('a', '2026-09-18T09:12:00.000Z'), // Friday → Monday Sep 14
    mkEvent('b', '2026-09-07T10:00:00.000Z'), // Monday Sep 7
  ];
  const sections = buildSections(events, null);
  check('two calendar bands', sections.length, 2);
  check('newest calendar band first', sections[0]?.key, 'cal-2026-09-14');
  check('calendar band title', sections[0]?.title, 'Week of Sep 14');
  check('calendar band subtitle', sections[0]?.subtitle, 'Sep 14 – 20');
  check('older calendar band', sections[1]?.key, 'cal-2026-09-07');
  check('older calendar band title', sections[1]?.title, 'Week of Sep 7');
  // A Sunday still belongs to the week starting the previous Monday.
  const sunday = buildSections([mkEvent('s', '2026-09-13T22:00:00.000Z')], null);
  check('Sunday → previous Monday band', sunday[0]?.key, 'cal-2026-09-07');
}

// ---------- buildSections: edge cases ----------

{
  check('empty input → no sections', buildSections([], DUE), []);
  // Malformed timestamps never crash grouping; they're skipped.
  const mixed = [
    mkEvent('bad', 'not-a-date'),
    mkEvent('good', '2026-09-18T09:12:00.000Z'),
  ];
  const sections = buildSections(mixed, DUE);
  check('bad timestamps skipped', sections.length, 1);
  check('good event still grouped', sections[0]?.data.map((e) => e.id), ['good']);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
