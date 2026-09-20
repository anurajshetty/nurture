/**
 * v1.1 unit tests: the 40-week matrix + the deterministic rules engine.
 *
 * Covers the release matrix: ordering, heads-up placement, staged-week
 * fallback, delight no-repeat behavior, and experienced variants being
 * materially deeper/different. Pure logic — no network, no SQLite.
 * Run with:
 *
 *   npx tsc tests/briefing_matrix.test.ts src/briefing/engine.ts \
 *     src/briefing/matrix.ts src/briefing/delight.ts src/briefing/context.ts \
 *     src/briefing/types.ts src/theme/tokens.ts src/lib/types.ts \
 *     src/onboarding/dates.ts \
 *     --outDir /tmp/nurture-matrix-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-matrix-tests/tests/briefing_matrix.test.js
 */

import { buildPlan, hashPlan, type EngineInput } from '../src/briefing/engine';
import {
  CURATED_WEEKS,
  FALLBACK_ROW,
  getMatrixRow,
  hasCuratedRow,
} from '../src/briefing/matrix';
import type { PlanSlot } from '../src/briefing/types';

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
    console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
  }
}

function checkTrue(name: string, v: boolean): void {
  check(name, v, true);
}

function input(over: Partial<EngineInput>): EngineInput {
  return {
    week: 36,
    day: 3,
    date: '2026-09-19',
    firstTimeMom: true,
    symptomThemes: [],
    logs: [],
    store: null,
    ...over,
  };
}

function sections(slots: PlanSlot[]): string[] {
  return slots.map((s) => s.section);
}

function titles(slots: PlanSlot[]): string[] {
  return slots.map((s) => s.title);
}

/* ------------------------------------------------------------------ */
/* Matrix: staged curation                                             */
/* ------------------------------------------------------------------ */

{
  checkTrue(
    'matrix: weeks 4-42 curated',
    CURATED_WEEKS.join(',') === Array.from({ length: 39 }, (_, i) => i + 4).join(','),
  );
  checkTrue('matrix: week 36 has curated row', hasCuratedRow(36));
  checkTrue('matrix: week 28 curated', hasCuratedRow(28));
  checkTrue('matrix: week 4 curated', hasCuratedRow(4));
  checkTrue('matrix: week 2 still falls back', !hasCuratedRow(2));

  // getMatrixRow never returns undefined for any valid week.
  for (let w = 4; w <= 42; w++) {
    const row = getMatrixRow(w);
    if (!row || typeof row.week !== 'number') {
      failed++;
      console.log(`FAIL matrix: getMatrixRow(${w}) is unusable`);
    } else {
      passed++;
    }
  }

  // Fallback rows carry safe generic copy — never empty seeds.
  const fb = getMatrixRow(2);
  checkTrue('matrix: fallback baby seeds non-empty', fb.routineSeeds.baby.length > 0);
  checkTrue('matrix: fallback body seeds non-empty', fb.routineSeeds.body.length > 0);
  checkTrue('matrix: fallback know seeds non-empty', fb.routineSeeds.know.length > 0);
  checkTrue('matrix: fallback tips seeds non-empty', fb.routineSeeds.tips.length > 0);
  check('matrix: fallback has no scary claims', FALLBACK_ROW.routineSeeds.baby.join(' ').includes('risk'), false);

  // Every curated row has the full shape.
  for (const w of CURATED_WEEKS) {
    const row = getMatrixRow(w);
    checkTrue(`matrix: week ${w} has baby anchor`, row.anchors.baby.length > 10);
    checkTrue(`matrix: week ${w} has body anchor`, row.anchors.body.length > 10);
    checkTrue(`matrix: week ${w} has routine seeds`, row.routineSeeds.baby.length > 0);
    checkTrue(`matrix: week ${w} has first-time note`, !!row.firstTimeNote);
    checkTrue(`matrix: week ${w} has experienced note`, !!row.experiencedNote);
  }
}

/* ------------------------------------------------------------------ */
/* Engine: ordering                                                    */
/* ------------------------------------------------------------------ */

{
  // Week 36, day 1: timely (weekly-visits + early-term countdown + 1 prep),
  // routine 4, headsup, delight 3. Quiet-day look-back is off on day 1.
  const plan = buildPlan(input({ week: 36, day: 1, date: '2026-09-19' }));
  const secs = sections(plan.slots);
  // Order must be non-decreasing in section rank.
  const rank: Record<string, number> = { timely: 0, routine: 1, headsup: 2, delight: 3, lookback: 4 };
  let ordered = true;
  for (let i = 1; i < secs.length; i++) {
    if (rank[secs[i]] < rank[secs[i - 1]]) ordered = false;
  }
  checkTrue('engine: sections in timely→routine→headsup→delight→lookback order', ordered);

  // Routine four in fixed order: baby → body → know → tips.
  const routineTitles = titles(plan.slots.filter((s) => s.section === 'routine'));
  check('engine: routine order baby→body→know→tips', routineTitles, [
    "Baby's development",
    "How you're doing",
    'Good to know',
    'Small comforts',
  ]);

  // "New this week" sits BELOW the routine cards, never at the top.
  const headsupIdx = plan.slots.findIndex((s) => s.section === 'headsup');
  const lastRoutineIdx = plan.slots.map((s) => s.section).lastIndexOf('routine');
  checkTrue('engine: headsup present on day 1', headsupIdx >= 0);
  checkTrue('engine: headsup below routine cards', headsupIdx > lastRoutineIdx);
  const headsup = plan.slots[headsupIdx];
  check('engine: headsup title', headsup.title, 'New this week');
  checkTrue(
    'engine: headsup teases next week',
    headsup.preview.includes('early term'),
  );
}

{
  // Heads-up only on gestational days 1–2.
  const day2 = buildPlan(input({ week: 36, day: 2, date: '2026-09-20' }));
  checkTrue('engine: headsup on day 2', day2.slots.some((s) => s.section === 'headsup'));
  const day3 = buildPlan(input({ week: 36, day: 3, date: '2026-09-21' }));
  checkTrue('engine: no headsup on day 3', !day3.slots.some((s) => s.section === 'headsup'));
  const day7 = buildPlan(input({ week: 36, day: 7, date: '2026-09-25' }));
  checkTrue('engine: no headsup on day 7', !day7.slots.some((s) => s.section === 'headsup'));
}

/* ------------------------------------------------------------------ */
/* Engine: timely — milestones + prep windows                          */
/* ------------------------------------------------------------------ */

{
  // Week 36 day 1: milestone "Weekly visits" (offset 0) + "One week to
  // early term" countdown (offset 1) + exactly one prep card.
  const plan = buildPlan(input({ week: 36, day: 1, date: '2026-09-19' }));
  const timely = plan.slots.filter((s) => s.section === 'timely');
  const timelyTitles = titles(timely);
  checkTrue('engine: week-36 milestone this week', timelyTitles.includes('Weekly visits'));
  checkTrue(
    'engine: week-36 milestone countdown next week',
    timelyTitles.includes('One week to early term'),
  );
  const prep = timely.filter((s) => s.slotId.startsWith('timely-prep-'));
  check('engine: max 1 prep card per day', prep.length, 1);
  // Earliest window end wins: hospital-bag [34,36] beats birth-plan [32,36]
  // on ties by listed order.
  check('engine: week-36 prep is the hospital bag', prep[0].slotId, 'timely-prep-hospital-bag');
}

{
  // Week 40: no next-week countdown for the due date itself (offset 0 only).
  const plan = buildPlan(input({ week: 40, day: 1, date: '2026-10-05' }));
  const timelyTitles = titles(plan.slots.filter((s) => s.section === 'timely'));
  checkTrue('engine: week-40 due-date milestone', timelyTitles.includes('Due date'));
}

{
  // Fallback week 2: the matrix prep set starts at week 32 — none active at 2.
  const plan = buildPlan(input({ week: 2, day: 3, date: '2026-07-20' }));
  checkTrue(
    'engine: no prep card when no window active',
    !plan.slots.some((s) => s.slotId.startsWith('timely-prep-')),
  );
  checkTrue('engine: fallback week still has routine 4', plan.slots.filter((s) => s.section === 'routine').length === 4);
  check('engine: fallback plan not curated', plan.curated, false);
  const curated = buildPlan(input({ week: 36, day: 3, date: '2026-09-21' }));
  check('engine: curated week flagged', curated.curated, true);
}

/* ------------------------------------------------------------------ */
/* Engine: delight — matrix steering, no repeats                       */
/* ------------------------------------------------------------------ */

{
  // Week 36 prefers its fact ids: 'head-down' must be pickable by rotation.
  // Day-of-year rotation over 3 ids — check the fact preview comes from the
  // matrix set on at least one day of a 3-day window.
  const previews = new Set<string>();
  for (let d = 0; d < 3; d++) {
    const date = `2026-09-${19 + d}`;
    const plan = buildPlan(input({ week: 36, day: 3, date }));
    const fact = plan.slots.find((s) => s.slotId === 'delight-card-fact');
    if (fact) previews.add(fact.preview);
  }
  checkTrue('engine: matrix fact ids rotate (no repeats in 3 days)', previews.size === 3);

  // The rotating 'milestone' card is suppressed when a curated milestone
  // countdown is already timely (week 36 day 1) — no duplicates.
  const plan = buildPlan(input({ week: 36, day: 1, date: '2026-09-19' }));
  const rotating = plan.slots.find((s) => s.slotId === 'delight-card-rotating');
  checkTrue(
    'engine: rotating card is not the milestone when a countdown is timely',
    !!rotating && rotating.title !== 'Milestone ahead',
  );

  // Delight slots are never phrased (already warm and curated).
  checkTrue(
    'engine: delight slots phrase=false',
    plan.slots.filter((s) => s.section === 'delight').every((s) => s.phrase === false),
  );
}

/* ------------------------------------------------------------------ */
/* Engine: first-time vs experienced variants                          */
/* ------------------------------------------------------------------ */

{
  const first = buildPlan(input({ week: 36, day: 3, date: '2026-09-21', firstTimeMom: true }));
  const exp = buildPlan(input({ week: 36, day: 3, date: '2026-09-21', firstTimeMom: false }));
  const knowFirst = first.slots.find((s) => s.slotId === 'routine-know');
  const knowExp = exp.slots.find((s) => s.slotId === 'routine-know');
  const textFirst = JSON.stringify(knowFirst?.body);
  const textExp = JSON.stringify(knowExp?.body);

  // Materially different — not the same note with a word swapped.
  checkTrue('engine: experienced know-card differs from first-time', textFirst !== textExp);
  checkTrue(
    'engine: first-time note orients (what things are)',
    textFirst.includes('Weekly visits are quick'),
  );
  checkTrue(
    'engine: experienced note goes deeper, never 101',
    textExp.includes("every pregnancy has its own texture"),
  );
  // The experienced variant must not repeat the first-timer's basic info.
  checkTrue(
    'engine: experienced variant does not repeat the 101 explanation',
    !textExp.includes('mostly heartbeat, measuring, and your questions'),
  );
}

/* ------------------------------------------------------------------ */
/* Engine: quiet-day look-back                                         */
/* ------------------------------------------------------------------ */

const LOGS = [
  { id: 'a', text: 'Felt the first real kick during lunch.', date: '2026-09-10' },
  { id: 'b', text: 'Bought the tiny socks.', date: '2026-09-18' },
];

{
  // Quiet day (3–7), eligible row, uncrowded plan → look-back appears.
  // Week 37 has 1 milestone + 1 prep (2 timely < 3), so it is not crowded.
  const plan = buildPlan(input({ week: 37, day: 4, date: '2026-09-28', logs: LOGS }));
  const lookback = plan.slots.find((s) => s.section === 'lookback');
  checkTrue('engine: look-back on quiet day', !!lookback);
  checkTrue(
    'engine: look-back quotes her words verbatim',
    !!lookback && JSON.stringify(lookback.body).includes('Bought the tiny socks.'),
  );
  check('engine: look-back never phrased', lookback?.phrase, false);
  // Picks the most recent entry at least 3 days old ('b' on Sep 18, 10 days
  // before Sep 28), not the older one.
  checkTrue(
    'engine: look-back prefers the most recent eligible entry',
    !!lookback && lookback.slotId === 'lookback-b',
  );
  // It renders after the delight cards (last).
  check('engine: look-back is the last slot', plan.slots[plan.slots.length - 1].section, 'lookback');
}

{
  // Not on days 1–2 (headsup days are busy by design).
  const plan = buildPlan(input({ week: 36, day: 1, date: '2026-09-19', logs: LOGS }));
  checkTrue('engine: no look-back on day 1', !plan.slots.some((s) => s.section === 'lookback'));
}

{
  // Crowded plan (2+ timely/headsup) → no look-back, even on quiet days.
  // Week 36 day 3: weekly-visits + early-term countdown + prep = 3 timely.
  const plan = buildPlan(input({ week: 36, day: 3, date: '2026-09-21', logs: LOGS }));
  const timelyCount = plan.slots.filter((s) => s.section === 'timely' || s.section === 'headsup').length;
  checkTrue('engine: week-36 day-3 plan is crowded', timelyCount >= 2);
  checkTrue('engine: no look-back when crowded', !plan.slots.some((s) => s.section === 'lookback'));
}

{
  // Ineligible row (week 42) → no look-back even on a quiet day.
  const plan = buildPlan(input({ week: 42, day: 5, date: '2026-11-16', logs: LOGS }));
  checkTrue('engine: no look-back when row ineligible', !plan.slots.some((s) => s.section === 'lookback'));

  // No logs → no look-back.
  const empty = buildPlan(input({ week: 37, day: 4, date: '2026-09-28', logs: [] }));
  checkTrue('engine: no look-back without logs', !empty.slots.some((s) => s.section === 'lookback'));
}

/* ------------------------------------------------------------------ */
/* Engine: determinism + hash                                          */
/* ------------------------------------------------------------------ */

{
  const a = buildPlan(input({ week: 36, day: 3, date: '2026-09-21', logs: LOGS }));
  const b = buildPlan(input({ week: 36, day: 3, date: '2026-09-21', logs: LOGS }));
  check('engine: same input → same plan', a.slots, b.slots);
  check('engine: same input → same hash', a.planHash, b.planHash);
  checkTrue('engine: hash is 8 hex chars', /^[0-9a-f]{8}$/.test(a.planHash));
  const c = buildPlan(input({ week: 36, day: 4, date: '2026-09-22', logs: LOGS }));
  checkTrue('engine: different day → different hash', a.planHash !== c.planHash);
  check('engine: hashPlan stable on fixed slots', hashPlan(a.slots), a.planHash);
}

/* ------------------------------------------------------------------ */
/* Phraser contract: previews ≤ 80, body lines ≤ 220                   */
/* ------------------------------------------------------------------ */

{
  // The Edge Function rejects phraser requests with previews over 80
  // chars or body lines over 220. Every phrase:true slot the engine can
  // emit must fit — across all curated weeks, both parities, days 1 and 3.
  for (const w of CURATED_WEEKS) {
    for (const day of [1, 3]) {
      for (const firstTime of [true, false]) {
        const plan = buildPlan(input({ week: w, day, date: '2026-09-19', firstTimeMom: firstTime }));
        for (const s of plan.slots) {
          if (!s.phrase) continue;
          if (s.preview.length > 80) {
            failed++;
            console.log(`FAIL contract: week ${w} ${s.slotId} preview is ${s.preview.length} chars (> 80)`);
          } else {
            passed++;
          }
          const lines = s.body.flatMap((p) => p.map((r) => r.text));
          for (const line of lines) {
            if (line.length > 220) {
              failed++;
              console.log(`FAIL contract: week ${w} ${s.slotId} body line is ${line.length} chars (> 220)`);
            } else {
              passed++;
            }
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Safety: content rules                                               */
/* ------------------------------------------------------------------ */

{
  // No prescriptive "you should", no risk language, across curated weeks.
  const banned = ['you should', 'you must', 'risk of', 'warning', '%'];
  for (const w of CURATED_WEEKS) {
    const plan = buildPlan(input({ week: w, day: 3, date: '2026-09-21', firstTimeMom: w % 2 === 0 }));
    const text = JSON.stringify(plan.slots.map((s) => [s.preview, s.body])).toLowerCase();
    for (const b of banned) {
      if (text.includes(b)) {
        failed++;
        console.log(`FAIL safety: week ${w} plan contains "${b}"`);
      } else {
        passed++;
      }
    }
  }
  // Fallback row too.
  const fb = buildPlan(input({ week: 2, day: 3, date: '2026-05-20' }));
  const fbText = JSON.stringify(fb.slots.map((s) => [s.preview, s.body])).toLowerCase();
  checkTrue('safety: fallback has no prescriptive language', !fbText.includes('you should'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
