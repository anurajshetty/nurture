/**
 * Epic 3.1 deterministic tests: timeline DAY grouping
 * (src/timeline/timeline.ts). Day groups approved by Anuraj Sept 20,
 * 2026 — "Today", "Yesterday", "Friday, Sep 18" — superseding the week
 * bands.
 *
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
  buildDaySections,
  formatDayGroupLabel,
  formatDayShort,
  formatWeekRange,
  localDayISO,
  pregnancyWeekForEvent,
  pregnancyWeekRange,
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
    createdAt: occurredAt,
    dirty: false,
  };
}

// Sample due date: 2026-10-08 → LMP 2026-01-01 (280 days earlier).
const DUE = '2026-10-08';

// ---------- pregnancy week range (week filter still uses these) ----------

{
  check('week 37 range', pregnancyWeekRange(37, DUE), {
    startISO: '2026-09-17',
    endISO: '2026-09-24',
  });
  check('week 1 starts 7 days after LMP', pregnancyWeekRange(1, DUE)?.startISO, '2026-01-08');
  check('week 0 invalid', pregnancyWeekRange(0, DUE), null);
  check('non-integer invalid', pregnancyWeekRange(24.5, DUE), null);
}

// ---------- week of an event (week FILTER matching, unchanged) ----------

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

// ---------- localDayISO: device-local calendar day ----------

{
  check('UTC timestamp → local day', localDayISO('2026-09-20T23:30:00.000Z'), '2026-09-20');
  // 01:30 at +05:30 is 2026-09-19 20:00 UTC → Sep 19 under TZ=UTC.
  check('offset timestamp → local day', localDayISO('2026-09-20T01:30:00+05:30'), '2026-09-19');
  check('midnight boundary keeps its own day', localDayISO('2026-09-20T00:03:00.000Z'), '2026-09-20');
  check('bad timestamp → null', localDayISO('not-a-date'), null);
}

// ---------- formatDayGroupLabel ----------

{
  // 2026-09-20 is a Sunday; Sep 19 Saturday; Sep 18 Friday.
  check('today label', formatDayGroupLabel('2026-09-20', '2026-09-20'), 'Today');
  check('yesterday label', formatDayGroupLabel('2026-09-19', '2026-09-20'), 'Yesterday');
  check('older label', formatDayGroupLabel('2026-09-18', '2026-09-20'), 'Friday, Sep 18');
  check('older label across months', formatDayGroupLabel('2026-08-31', '2026-09-20'), 'Monday, Aug 31');
  check('bad day passes through', formatDayGroupLabel('nope', '2026-09-20'), 'nope');
}

// ---------- buildDaySections: day groups, newest first ----------

{
  const events = [
    mkEvent('c', '2026-09-18T18:00:00.000Z'), // Friday — deliberately oldest-first
    mkEvent('a', '2026-09-20T09:12:00.000Z'), // Sunday (today)
    mkEvent('b', '2026-09-20T20:04:00.000Z'), // Sunday (today), later
    mkEvent('d', '2026-09-19T08:00:00.000Z'), // Saturday (yesterday)
  ];
  const sections = buildDaySections(events, '2026-09-20');
  check('three day groups', sections.length, 3);
  check('newest day first', sections[0]?.key, 'day-2026-09-20');
  check('today title', sections[0]?.title, 'Today');
  check('newest event first within the day', sections[0]?.data.map((e: LocalEvent) => e.id), ['b', 'a']);
  check('yesterday second', sections[1]?.key, 'day-2026-09-19');
  check('yesterday title', sections[1]?.title, 'Yesterday');
  check('older day label', sections[2]?.title, 'Friday, Sep 18');
  check('older day contents', sections[2]?.data.map((e: LocalEvent) => e.id), ['c']);
}

// ---------- buildDaySections: the midnight boundary ----------

{
  // The mockup's boundary case: "Yesterday · 11:58 PM" and
  // "Today · 12:03 AM" kick sessions land in different groups.
  const late = mkEvent('late', '2026-09-19T23:58:00.000Z');
  const early = mkEvent('early', '2026-09-20T00:03:00.000Z');
  const sections = buildDaySections([late, early], '2026-09-20');
  check('midnight boundary → two groups', sections.length, 2);
  check('12:03 AM in Today', sections[0]?.data.map((e: LocalEvent) => e.id), ['early']);
  check('11:58 PM in Yesterday', sections[1]?.data.map((e: LocalEvent) => e.id), ['late']);
}

// ---------- buildDaySections: edge cases ----------

{
  check('empty input → no sections', buildDaySections([], '2026-09-20'), []);
  // Malformed timestamps never crash grouping; they're skipped.
  const mixed = [
    mkEvent('bad', 'not-a-date'),
    mkEvent('good', '2026-09-18T09:12:00.000Z'),
  ];
  const sections = buildDaySections(mixed, '2026-09-20');
  check('bad timestamps skipped', sections.length, 1);
  check('good event still grouped', sections[0]?.data.map((e: LocalEvent) => e.id), ['good']);
}

// ---------- storyDateOf: every entry sits where it was logged ----------

function mkAppt(id: string, occurredAt: string, createdAt: string): LocalEvent {
  return {
    id,
    userId: null,
    pregnancyId: null,
    type: 'appointment',
    occurredAt,
    visibility: 'private',
    data: {},
    idempotencyKey: id,
    deletedAt: null,
    updatedAt: createdAt,
    createdAt,
    dirty: false,
  };
}

function mkReport(id: string, documentDate: string, createdAt: string): LocalEvent {
  return {
    id,
    userId: null,
    pregnancyId: null,
    type: 'report',
    occurredAt: documentDate,
    visibility: 'private',
    data: {},
    idempotencyKey: id,
    deletedAt: null,
    updatedAt: createdAt,
    createdAt,
    dirty: false,
  };
}

{
  const appt = mkAppt('a', '2026-10-05T10:00:00.000Z', '2026-09-19T09:00:00.000Z');
  const report = mkReport('r', '2026-08-01T10:00:00.000Z', '2026-09-19T09:00:00.000Z');
  const note = mkEvent('n', '2026-09-19T09:00:00.000Z');
  check('storyDateOf: appointment → createdAt', storyDateOf(appt), '2026-09-19T09:00:00.000Z');
  check('storyDateOf: report → createdAt (not document date)', storyDateOf(report), '2026-09-19T09:00:00.000Z');
  check('storyDateOf: note → createdAt', storyDateOf(note), '2026-09-19T09:00:00.000Z');
  const legacy = { ...appt, createdAt: '' };
  check('storyDateOf: blank createdAt falls back to occurredAt', storyDateOf(legacy), appt.occurredAt);
}

{
  // A: visit scheduled Oct 5, logged Sep 19. B: visit scheduled Sep 21,
  // logged Sep 20. Story order must be B then A (logged later first),
  // even though A's visit is later — and they group by the day they
  // were LOGGED, not the visit day.
  const a = mkAppt('a', '2026-10-05T10:00:00.000Z', '2026-09-19T09:00:00.000Z');
  const b = mkAppt('b', '2026-09-21T10:00:00.000Z', '2026-09-20T09:00:00.000Z');
  const sections = buildDaySections([a, b], '2026-09-20');
  const flat = sections.flatMap((s) => s.data.map((e: LocalEvent) => e.id));
  check('appointments sort by created date, not scheduled date', flat, ['b', 'a']);
  check(
    'appointments group by logged day',
    sections.map((s: { key: string }) => s.key),
    ['day-2026-09-20', 'day-2026-09-19'],
  );
}

{
  // R: report with a document date of Aug 1 but logged Sep 20. S:
  // report with document date Sep 18 but logged Sep 19. Story order must
  // be R then S (logged later first) — sorted by created date, never by
  // document date — and both group by logged day.
  const r = mkReport('r', '2026-08-01T10:00:00.000Z', '2026-09-20T09:00:00.000Z');
  const s = mkReport('s', '2026-09-18T10:00:00.000Z', '2026-09-19T09:00:00.000Z');
  const sections = buildDaySections([r, s], '2026-09-20');
  const flat = sections.flatMap((sec) => sec.data.map((e: LocalEvent) => e.id));
  check('reports sort by created date, not document date', flat, ['r', 's']);
  check(
    'reports group by logged day',
    sections.map((sec: { key: string }) => sec.key),
    ['day-2026-09-20', 'day-2026-09-19'],
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
