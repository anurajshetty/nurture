/**
 * Track 2 unit tests (v1.2): visit-prep + milestone-celebrated Home cards.
 *
 * Engine decision table (proposal §5, contracts frozen with Track 1):
 * - visit-prep fires when the upcoming appointment is ≤3 days away
 *   (boundary inclusive); copy carries the non-dismissed question count.
 * - milestone-celebrated fires on a recent milestone (≤7 days, boundary
 *   inclusive), one-time per event id via the v12.celebrated.<id> kv key,
 *   auto-expiring after 7 days.
 * - Both cards are suppressed when pregnancyActive is false (Epic 9 C3,
 *   planner pattern).
 * - Age-band framing: the ageBandNotes → body-card path is verified
 *   end-to-end; v1.2 changes no copy.
 *
 * Pure logic only — in-memory KvStore, injected "today". No network, no
 * SQLite. Run with:
 *
 *   npx tsc tests/v12_home_cards.test.ts src/briefing/v12cards.ts \
 *     src/briefing/engine.ts src/briefing/policy.ts src/briefing/cache.ts \
 *     src/briefing/client.ts src/briefing/matrix.ts src/briefing/delight.ts \
 *     src/briefing/context.ts src/briefing/types.ts src/plan/questions.ts \
 *     src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts \
 *     --outDir /tmp/nurture-v12-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop --ignoreConfig
 *   node /tmp/nurture-v12-tests/tests/v12_home_cards.test.js
 */

import {
  applyAgeBandNote,
  buildPlan,
  type EngineInput,
} from '../src/briefing/engine';
import {
  celebratedKey,
  celebratedLine,
  isCelebrated,
  isWithinDaysAgo,
  isWithinDaysAhead,
  markCelebrated,
  openQuestionCount,
  v12Title,
  visitPrepLine,
  weekdayOf,
  type V12Appointment,
  type V12Milestone,
} from '../src/briefing/v12cards';
import { refreshBriefing } from '../src/briefing/policy';
import { getMatrixRow, type WeekMatrixRow } from '../src/briefing/matrix';
import type { KvStore } from '../src/briefing/cache';
import type { RichBody } from '../src/briefing/types';
import type { BriefingContext } from '../src/briefing/context';
import { colors } from '../src/theme/tokens';

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

/* ------------------------------------------------------------------ */
/* Fixtures — today is 2026-09-19, a Saturday.                        */
/* ------------------------------------------------------------------ */

const TODAY = '2026-09-19';

function memStore(): KvStore {
  const m = new Map<string, string>();
  return {
    get: (k) => (m.has(k) ? (m.get(k) as string) : null),
    set: (k, v) => {
      m.set(k, v);
    },
  };
}

function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    week: 36,
    day: 3,
    date: TODAY,
    firstTimeMom: true,
    symptomThemes: [],
    logs: [],
    store: memStore(),
    ...over,
  };
}

const q = (id: string, state: string) => ({
  id,
  text: `Question ${id}?`,
  state,
});

/** Appointment `daysAhead` calendar days after today (may be negative). */
function appt(
  daysAhead: number,
  questions: unknown[] = [],
  title: unknown = 'Check-up',
): V12Appointment {
  const d = 19 + daysAhead;
  return {
    id: `appt-${daysAhead}`,
    occurredAt: `2026-09-${String(d).padStart(2, '0')}T10:00:00`,
    data: { title, questions },
  };
}

/** Milestone `daysAgo` calendar days before today (may be negative). */
function milestone(daysAgo: number, id = 'ms-1'): V12Milestone {
  const d = 19 - daysAgo;
  return {
    id,
    occurredAt: `2026-09-${String(d).padStart(2, '0')}T09:00:00`,
    data: { title: 'First kicks' },
  };
}

function slotIds(plan: { slots: Array<{ slotId: string }> }): string[] {
  return plan.slots.map((s) => s.slotId);
}

function slotById(plan: { slots: Array<{ slotId: string }> }, id: string) {
  return plan.slots.find((s) => s.slotId === id) as
    | {
        slotId: string;
        section: string;
        title: string;
        preview: string;
        body: RichBody;
        phrase: boolean;
        tint: string;
        glyph: string;
        glyphColor: string;
        testID: string;
        celebratedEventId?: string;
      }
    | undefined;
}

/* ------------------------------------------------------------------ */
/* Date-window helpers                                                  */
/* ------------------------------------------------------------------ */

check('weekdayOf: 2026-09-24 is Thursday', weekdayOf('2026-09-24T10:00:00'), 'Thursday');
check('weekdayOf: today is Saturday', weekdayOf(TODAY), 'Saturday');
check('weekdayOf: garbage → null', weekdayOf('not-a-date'), null);

checkTrue('ahead: today (0d) inside 3d', isWithinDaysAhead(`${TODAY}T10:00:00`, TODAY, 3));
checkTrue('ahead: +3d boundary inside', isWithinDaysAhead('2026-09-22T10:00:00', TODAY, 3));
check('ahead: +4d outside', isWithinDaysAhead('2026-09-23T10:00:00', TODAY, 3), false);
check('ahead: past outside', isWithinDaysAhead('2026-09-18T10:00:00', TODAY, 3), false);
check('ahead: garbage → false', isWithinDaysAhead('xx', TODAY, 3), false);

checkTrue('ago: 7d boundary recent', isWithinDaysAgo('2026-09-12T09:00:00', TODAY, 7));
check('ago: 8d outside', isWithinDaysAgo('2026-09-11T09:00:00', TODAY, 7), false);
check('ago: future outside', isWithinDaysAgo('2026-09-20T09:00:00', TODAY, 7), false);

/* ------------------------------------------------------------------ */
/* Visit-prep: ≤3-day window (boundary inclusive)                        */
/* ------------------------------------------------------------------ */

for (const d of [0, 1, 2, 3]) {
  const plan = buildPlan(baseInput({ upcomingAppointment: appt(d) }));
  checkTrue(`visit-prep fires at +${d}d`, slotIds(plan).includes('timely-visit-prep'));
}
check(
  'visit-prep silent at +4d',
  slotIds(buildPlan(baseInput({ upcomingAppointment: appt(4) }))).includes(
    'timely-visit-prep',
  ),
  false,
);
check(
  'visit-prep silent for a past appointment',
  slotIds(buildPlan(baseInput({ upcomingAppointment: appt(-1) }))).includes(
    'timely-visit-prep',
  ),
  false,
);
check(
  'visit-prep silent with no appointment',
  slotIds(buildPlan(baseInput())).includes('timely-visit-prep'),
  false,
);

/* ------------------------------------------------------------------ */
/* Visit-prep copy (proposal §5, approved)                               */
/* ------------------------------------------------------------------ */

check(
  'copy N=3',
  visitPrepLine(appt(5, [q('a', 'to_ask'), q('b', 'asked'), q('c', 'deferred')])),
  'Check-up Thursday · 3 questions waiting in your inbox. Anything else on your mind before you go?',
);
check(
  'copy N=1 singular',
  visitPrepLine(appt(5, [q('a', 'to_ask')])),
  'Check-up Thursday · 1 question waiting in your inbox. Anything else on your mind before you go?',
);
check(
  'copy N=0 drops the count clause',
  visitPrepLine(appt(5, [])),
  'Check-up Thursday · Anything on your mind before you go?',
);
check(
  'dismissed questions do not count (answered does)',
  openQuestionCount({
    questions: [
      q('a', 'to_ask'),
      q('b', 'answered'),
      q('c', 'dismissed'),
      q('d', 'dismissed'),
    ],
  }),
  2,
);
check(
  'malformed questions payload → 0, no throw',
  openQuestionCount({ questions: 'nope' }),
  0,
);
check(
  'missing title falls back to Appointment',
  visitPrepLine({ ...appt(5, []), data: { questions: [] } }),
  'Appointment Thursday · Anything on your mind before you go?',
);
check(
  'long title truncates to a row-safe length',
  v12Title({ title: `${'x'.repeat(100)}` }, 'Appointment').length,
  78, // 77 chars + ellipsis
);

/* ------------------------------------------------------------------ */
/* Visit-prep slot contract — generic row, reused TILES, no new UI      */
/* ------------------------------------------------------------------ */

{
  const plan = buildPlan(
    baseInput({ upcomingAppointment: appt(2, [q('a', 'to_ask')]) }),
  );
  const s = slotById(plan, 'timely-visit-prep');
  checkTrue('visit-prep slot exists', !!s);
  if (s) {
    check('visit-prep section', s.section, 'timely');
    check('visit-prep testID', s.testID, 'home-visit-prep');
    check('visit-prep title', s.title, 'Check-up');
    check(
      'visit-prep preview',
      s.preview,
      'Check-up Monday · 1 question waiting in your inbox. Anything else on your mind before you go?',
    );
    check('visit-prep phrase=false (personal data stays on-device)', s.phrase, false);
    // Reuses the existing timely-prep tile — no new styling entries.
    check('visit-prep tint reuses timely-prep', s.tint, colors.sageTint);
    check('visit-prep glyph reuses timely-prep', s.glyph, '✓');
    check('visit-prep glyphColor reuses timely-prep', s.glyphColor, colors.sageDeep);
  }
}

/* ------------------------------------------------------------------ */
/* Milestone celebrated: recency, one-time kv, auto-expiry               */
/* ------------------------------------------------------------------ */

check(
  'celebrated copy',
  celebratedLine(milestone(3)),
  'First kicks — saved to your story ♥',
);
check(
  'celebrated copy falls back when untitled',
  celebratedLine({ id: 'x', occurredAt: `${TODAY}T09:00:00`, data: {} }),
  'Milestone — saved to your story ♥',
);

{
  const store = memStore();
  const plan = buildPlan(
    baseInput({ store, recentMilestone: milestone(3, 'ms-one') }),
  );
  const s = slotById(plan, 'timely-milestone-celebrated');
  checkTrue('celebrated slot fires on a 3-day-old milestone', !!s);
  if (s) {
    check('celebrated section', s.section, 'timely');
    check('celebrated testID', s.testID, 'home-milestone-celebrated');
    check('celebrated phrase=false (her words stay on-device)', s.phrase, false);
    // Reuses the existing timely-milestone tile — no new styling entries.
    check('celebrated tint reuses timely-milestone', s.tint, '#E2F0EF');
    check('celebrated glyph reuses timely-milestone', s.glyph, '☀');
    check('celebrated glyphColor reuses timely-milestone', s.glyphColor, '#5F9E9B');
  }
  // kv keying: the engine stays pure — buildPlan READS the gate but never
  // writes the mark. The delivery layer (policy.ts) writes it when the
  // briefing actually reaches the screen.
  check('celebrated kv key NOT written by buildPlan (engine pure)',
    store.get(celebratedKey('ms-one')), null);
  check('celebrated slot carries the event id for delivery-time marking',
    s?.celebratedEventId, 'ms-one');
  check('isCelebrated false before delivery', isCelebrated(store, 'ms-one'), false);
  // Simulate delivery (what policy.ts does on a delivered briefing).
  if (s?.celebratedEventId) markCelebrated(store, s.celebratedEventId, TODAY);
  checkTrue('isCelebrated true after delivery mark', isCelebrated(store, 'ms-one'));
  check('isCelebrated false for other ids', isCelebrated(store, 'ms-two'), false);
  // One-time: a rebuild with the same store never resurfaces the card
  // (dismissal persistence — the accordion collapse is the dismiss).
  const again = buildPlan(
    baseInput({ store, recentMilestone: milestone(3, 'ms-one') }),
  );
  check(
    'celebrated never resurfaces for the same event id',
    slotIds(again).includes('timely-milestone-celebrated'),
    false,
  );
  // …but a different milestone event still gets its own card.
  const other = buildPlan(
    baseInput({ store, recentMilestone: milestone(1, 'ms-two') }),
  );
  checkTrue(
    'celebrated fires once per event id (new id → card)',
    slotIds(other).includes('timely-milestone-celebrated'),
  );
}
{
  // Regression: a plan that is built but discarded (stale refresh, double
  // effect) must NOT burn the one-time mark — the card has to survive until
  // a briefing is actually delivered.
  const store = memStore();
  const discarded = buildPlan(
    baseInput({ store, recentMilestone: milestone(1, 'ms-disc') }),
  );
  checkTrue(
    'discarded build still emits the card',
    slotIds(discarded).includes('timely-milestone-celebrated'),
  );
  check(
    'discarded build writes no kv mark',
    store.get(celebratedKey('ms-disc')),
    null,
  );
  const redelivered = buildPlan(
    baseInput({ store, recentMilestone: milestone(1, 'ms-disc') }),
  );
  checkTrue(
    'card resurfaces after a discarded build (mark not burned)',
    slotIds(redelivered).includes('timely-milestone-celebrated'),
  );
}

// 7-day recency boundary: the auto-expiry.
checkTrue(
  'celebrated fires at exactly 7 days',
  slotIds(buildPlan(baseInput({ recentMilestone: milestone(7, 'ms-7') }))).includes(
    'timely-milestone-celebrated',
  ),
);
check(
  'celebrated auto-expires after 7 days',
  slotIds(buildPlan(baseInput({ recentMilestone: milestone(8, 'ms-8') }))).includes(
    'timely-milestone-celebrated',
  ),
  false,
);
check(
  'celebrated silent for a future-dated milestone',
  slotIds(buildPlan(baseInput({ recentMilestone: milestone(-1, 'ms-f') }))).includes(
    'timely-milestone-celebrated',
  ),
  false,
);
check(
  'celebrated suppressed without a store (one-time unenforceable)',
  slotIds(
    buildPlan(baseInput({ store: null, recentMilestone: milestone(1, 'ms-ns') })),
  ).includes('timely-milestone-celebrated'),
  false,
);
{
  // markCelebrated tolerates a throwing store.
  const bad = {
    get: () => null,
    set: () => {
      throw new Error('kv down');
    },
  };
  markCelebrated(bad, 'ms-x', TODAY); // must not throw
  checkTrue('markCelebrated never throws', true);
  check('isCelebrated false on throwing get', isCelebrated(bad, 'ms-x'), false);
}

/* ------------------------------------------------------------------ */
/* Contract C3: stop-state suppression (planner pattern)               */
/* ------------------------------------------------------------------ */

{
  const stopped = buildPlan(
    baseInput({
      pregnancyActive: false,
      upcomingAppointment: appt(1, [q('a', 'to_ask')]),
      recentMilestone: milestone(1, 'ms-stop'),
    }),
  );
  const ids = slotIds(stopped);
  check('C3: no visit-prep when stopped', ids.includes('timely-visit-prep'), false);
  check(
    'C3: no milestone-celebrated when stopped',
    ids.includes('timely-milestone-celebrated'),
    false,
  );
  // …and nothing was marked celebrated while suppressed.
  const store = memStore();
  buildPlan(
    baseInput({
      store,
      pregnancyActive: false,
      recentMilestone: milestone(1, 'ms-stop2'),
    }),
  );
  check('C3: no kv write while suppressed', store.get(celebratedKey('ms-stop2')), null);
}
{
  // Default (field absent) = active: existing callers are unaffected.
  const ids = slotIds(
    buildPlan(
      baseInput({
        upcomingAppointment: appt(1),
        recentMilestone: milestone(1, 'ms-def'),
      }),
    ),
  );
  checkTrue('default pregnancyActive=true: visit-prep fires', ids.includes('timely-visit-prep'));
  checkTrue(
    'default pregnancyActive=true: celebrated fires',
    ids.includes('timely-milestone-celebrated'),
  );
}

/* ------------------------------------------------------------------ */
/* Ordering: timely section, visit-prep before celebrated               */
/* ------------------------------------------------------------------ */

{
  const ids = slotIds(
    buildPlan(
      baseInput({
        upcomingAppointment: appt(1),
        recentMilestone: milestone(1, 'ms-ord'),
      }),
    ),
  );
  const vp = ids.indexOf('timely-visit-prep');
  const mc = ids.indexOf('timely-milestone-celebrated');
  const routine = ids.indexOf('routine-baby');
  checkTrue('visit-prep is first of the v1.2 pair', vp !== -1 && vp < mc);
  checkTrue('v1.2 cards sit ahead of the routine four', mc < routine);
}

/* ------------------------------------------------------------------ */
/* Age-band framing: verify the path end-to-end (no copy changes)      */
/* ------------------------------------------------------------------ */

{
  const row = getMatrixRow(36) as WeekMatrixRow & {
    ageBandNotes?: Record<string, string>;
  };
  const withNotes: WeekMatrixRow = {
    ...row,
    ageBandNotes: { '35-39': 'Note for 35-39.' },
  };
  const body: RichBody = [];
  applyAgeBandNote(body, withNotes, '35-39');
  check('age-band note appended for the matching band', body, [
    [{ text: 'Note for 35-39.' }],
  ]);
  const other: RichBody = [];
  applyAgeBandNote(other, withNotes, '40-plus');
  check('no note for a non-matching band', other, []);
  const none: RichBody = [];
  applyAgeBandNote(none, withNotes, undefined);
  check('no note when ageBand is unset', none, []);
  const noNotes: RichBody = [];
  applyAgeBandNote(noNotes, row, '35-39');
  check('no note when the row sets none', noNotes, []);
  const empty: RichBody = [];
  applyAgeBandNote(empty, { ...row, ageBandNotes: { '35-39': '' } }, '35-39');
  check('empty note is not appended', empty, []);
}
{
  // End-to-end through buildPlan: the body card renders with her age band
  // set; the curated matrix has no ageBandNotes yet, so the path is
  // exercised (no crash, no stray paragraph) without any copy change.
  const plan = buildPlan(baseInput({ ageBand: '35-39' }));
  const bodyCard = slotById(plan, 'routine-body');
  checkTrue('routine-body slot exists with ageBand set', !!bodyCard);
  if (bodyCard) {
    const texts = bodyCard.body.map((p) => p.map((r) => r.text).join(''));
    // The body card renders the curated seeds; with no ageBandNotes on the
    // row, the path appends nothing — same paragraphs, no crash.
    check(
      'body card unchanged when the row sets no age-band note',
      texts,
      getMatrixRow(36).routineSeeds.body,
    );
  }
}

/* ------------------------------------------------------------------ */
/* planHash stays deterministic                                        */
/* ------------------------------------------------------------------ */

{
  const a = buildPlan(
    baseInput({ upcomingAppointment: appt(2), recentMilestone: milestone(2, 'm-a') }),
  );
  const b = buildPlan(
    baseInput({ upcomingAppointment: appt(2), recentMilestone: milestone(2, 'm-a') }),
  );
  check('planHash deterministic across builds', a.planHash, b.planHash);
}

/* ------------------------------------------------------------------ */
/* Policy wiring: the hook's assembly deps reach the engine            */
/* ------------------------------------------------------------------ */

async function policyCase(
  name: string,
  deps: {
    getUpcomingAppointment?: () => V12Appointment | null;
    getRecentMilestone?: () => V12Milestone | null;
    isPregnancyActive?: () => boolean;
  },
  expectVisitPrep: boolean,
  expectCelebrated: boolean,
  /** When set, the delivery layer must have burned this celebration mark. */
  expectMarkId?: string,
): Promise<void> {
  const store = memStore();
  const ctx = {
    week: 36,
    day: 3,
    firstTimeMom: true,
    symptomThemes: [],
  } as BriefingContext;
  let terminal: { status: string; ids: string[] } | null = null;
  await refreshBriefing({
    today: TODAY,
    store,
    online: false,
    buildContext: () => ctx,
    getRecentLogs: () => [],
    ...deps,
    onUpdate: (status, briefing) => {
      if (status === 'offline' && briefing) {
        terminal = { status, ids: briefing.slots.map((s) => s.slotId) };
      }
    },
  });
  check(`${name}: briefing built offline`, !!terminal, true);
  if (terminal) {
    const t = terminal as { status: string; ids: string[] };
    check(`${name}: visit-prep`, t.ids.includes('timely-visit-prep'), expectVisitPrep);
    check(
      `${name}: celebrated`,
      t.ids.includes('timely-milestone-celebrated'),
      expectCelebrated,
    );
  }
  if (expectMarkId) {
    check(
      `${name}: delivery burns the celebration mark`,
      store.get(celebratedKey(expectMarkId)),
      TODAY,
    );
  }
}

async function main(): Promise<void> {
  await policyCase(
    'policy passes store signals to the engine',
    {
      getUpcomingAppointment: () => appt(2, [q('a', 'to_ask')]),
      getRecentMilestone: () => milestone(2, 'ms-pol'),
      isPregnancyActive: () => true,
    },
    true,
    true,
    'ms-pol',
  );
  await policyCase(
    'policy suppresses both cards when stopped (C3)',
    {
      getUpcomingAppointment: () => appt(2),
      getRecentMilestone: () => milestone(2, 'ms-pol2'),
      isPregnancyActive: () => false,
    },
    false,
    false,
  );
  await policyCase(
    'policy tolerates throwing signal readers',
    {
      getUpcomingAppointment: () => {
        throw new Error('db down');
      },
      getRecentMilestone: () => {
        throw new Error('db down');
      },
    },
    false,
    false,
  );
  await policyCase(
    'policy works with no v1.2 deps (old callers)',
    {},
    false,
    false,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
