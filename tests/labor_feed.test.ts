/**
 * Labor activities in the log feed — deterministic tests (mockup 32 rev 2,
 * Anuraj approved Sept 21, 2026).
 *
 * Pure logic only: unified Activity-card copy (src/labor/feed.ts), the
 * "log for everything" delete copy (src/timeline/deleteCopy.ts), the
 * one-card-per-visit rule (newVisitEntries), the idempotency guard
 * (alreadySavedEvent), and the filter mapping including the NEW
 * "Activity" filter chip (src/timeline/TimelineFilters.tsx).
 *
 * Exact-copy pins (from the approved mockup):
 * - Kicker: "Activity" (EventCard TYPE_META label); card names the
 *   activity inside: "Contraction timing" / "Breathing" / "Pelvic floor".
 * - Contraction: "6 contractions in 1 hour 20 minutes · about 12
 *   minutes apart, 45 seconds long on average." + provider line
 *   "Your care team knows your situation best."
 * - Breathing: "Slow-paced breathing · 1 round · a full minute, opened
 *   and closed with a cleansing breath."
 * - Pelvic floor: "Connection breath · 3 sets · gentle guided practice,
 *   about 5 minutes."
 * - Delete (Anuraj Sept 21 ~08:07 PDT: "log" for everything):
 *   "Delete this log?" / "This log leaves your story — and your partner's
 *   view too. This can't be undone." / "Delete log" → toast "Log deleted —
 *   removed from your partner's view too."
 * - Copy rules: no triage/verdict language, no 5-1-1 on cards.
 *
 * Regression guards (this is the release's pre-push test):
 * - Delete flow: an 'activity' event resolves to the 'activity' delete
 *   kind with the verbatim "log" copy.
 * - Activity filter: shows labor activities ONLY — kick sessions keep
 *   their own identity and are excluded; 'all' and 'logs' still include
 *   activity cards (additive, position after Logs is a UI concern).
 *
 * Run with:
 *
 *   npx tsc tests/labor_feed.test.ts src/labor/feed.ts \
 *     src/timeline/deleteCopy.ts src/timeline/TimelineFilters.tsx \
 *     src/lib/types.ts --outDir /tmp/nurture-tests --module commonjs \
 *     --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests/tests/labor_feed.test.js
 */

declare const process: { exit(code: number): void };
// `require` comes from @types/node (same pattern as
// tests/epic3_filters.test.ts) — no local declaration, which would clash
// with the react-native type chain pulled in by TimelineFilters.
const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'react-native') {
    return {
      ScrollView: 'ScrollView',
      Pressable: 'Pressable',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s: unknown) => s },
    };
  }
  return origLoad.call(this, request, ...rest);
};

const feed = require('../src/labor/feed') as {
  ACTIVITY_NAMES: Record<string, string>;
  CONTRACTION_PROVIDER_LINE: string;
  activitySub: (card: unknown) => string;
  activityProviderLine: (card: unknown) => string | null;
  readActivityCard: (data: unknown) => unknown;
  newVisitEntries: <T extends { id: string }>(
    baseline: ReadonlySet<string> | readonly string[],
    current: readonly T[],
  ) => T[];
  alreadySavedEvent: (
    events: ReadonlyArray<{ type: string; deletedAt: string | null; data: Record<string, unknown> }>,
    sessionKey: string,
  ) => boolean;
};

const dc = require('../src/timeline/deleteCopy') as {
  DELETE_COPY: Record<string, { xLabel: string; title: string; body: string; confirmLabel: string; toast: string }>;
  deleteKindFor: (event: { type: string; data?: Record<string, unknown> }) => string;
};

const filters = require('../src/timeline/TimelineFilters') as {
  matchesFilter: (event: { type: string; data?: Record<string, unknown> }, filter: string) => boolean;
};

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- unified card: activity named inside ---------------- */

check(
  'ACTIVITY_NAMES names all three activities inside the card',
  eq(feed.ACTIVITY_NAMES, {
    contraction: 'Contraction timing',
    breathing: 'Breathing',
    pelvicfloor: 'Pelvic floor',
  }),
);

const contractionCard = {
  sessionKey: 'k1',
  activityKind: 'contraction',
  count: 6,
  spanSec: 4800,
  avgIntervalSec: 720,
  avgDurationSec: 45,
};
check(
  'contraction sub line (mockup verbatim)',
  feed.activitySub(contractionCard) ===
    '6 contractions in 1 hour 20 minutes · about 12 minutes apart, 45 seconds long on average.',
  JSON.stringify(feed.activitySub(contractionCard)),
);

const singleCard = {
  sessionKey: 'k2',
  activityKind: 'contraction',
  count: 1,
  spanSec: 45,
  avgIntervalSec: null,
  avgDurationSec: 45,
};
check(
  'single contraction: no interval, duration only',
  feed.activitySub(singleCard) === '1 contraction · about 45 seconds long.',
  JSON.stringify(feed.activitySub(singleCard)),
);

check(
  'provider line is the approved verbatim copy',
  feed.CONTRACTION_PROVIDER_LINE === 'Your care team knows your situation best.',
);

check(
  'provider line appears ONLY on contraction cards',
  feed.activityProviderLine(contractionCard) === feed.CONTRACTION_PROVIDER_LINE &&
    feed.activityProviderLine({ sessionKey: 'k3', activityKind: 'breathing' }) === null &&
    feed.activityProviderLine({ sessionKey: 'k4', activityKind: 'pelvicfloor' }) === null,
);

check(
  'breathing sub line (mockup verbatim)',
  feed.activitySub({
    sessionKey: 'k5',
    activityKind: 'breathing',
    patternId: 'slow',
    patternName: 'Slow-paced breathing',
    rounds: 1,
    durationSec: 60,
  }) === 'Slow-paced breathing · 1 round · a full minute, opened and closed with a cleansing breath.',
);

check(
  'pelvic floor sub line (mockup verbatim)',
  feed.activitySub({
    sessionKey: 'k6',
    activityKind: 'pelvicfloor',
    exerciseId: 'connection',
    exerciseTitle: 'Connection breath',
    sets: 3,
    durationMin: 5,
  }) === 'Connection breath · 3 sets · gentle guided practice, about 5 minutes.',
);

/* ---------------- copy rules: no triage / verdict language ---------------- */

const allCopy = [
  feed.activitySub(contractionCard),
  feed.activitySub(singleCard),
  feed.CONTRACTION_PROVIDER_LINE,
  feed.activitySub({ sessionKey: 'k5', activityKind: 'breathing', patternId: 'p', patternName: 'Slow-paced breathing', rounds: 1, durationSec: 60 }),
  feed.activitySub({ sessionKey: 'k6', activityKind: 'pelvicfloor', exerciseId: 'e', exerciseTitle: 'Connection breath', sets: 3, durationMin: 5 }),
].join(' | ');
const banned = ['go to the hospital', 'you may be in labor', 'baby is fine', '5-1-1', '511', 'streak', 'failed', 'missed'];
check(
  'no triage/verdict/5-1-1 language on activity cards',
  !banned.some((w) => allCopy.toLowerCase().includes(w)),
);

/* ---------------- forgiving reader ---------------- */

check(
  'readActivityCard accepts a full contraction payload',
  (() => {
    const c = feed.readActivityCard({
      sessionKey: 'k1', activityKind: 'contraction', count: 6,
      spanSec: 4800, avgIntervalSec: 720, avgDurationSec: 45,
    }) as { activityKind: string } | null;
    return !!c && c.activityKind === 'contraction';
  })(),
);
check(
  'readActivityCard rejects unknown activity kinds',
  feed.readActivityCard({ sessionKey: 'k', activityKind: 'yoga' }) === null,
);
check(
  'readActivityCard rejects malformed payloads (never crashes the feed)',
  feed.readActivityCard(undefined) === null &&
    feed.readActivityCard({ sessionKey: 'k' }) === null &&
    feed.readActivityCard({ sessionKey: 'k', activityKind: 'breathing' }) === null,
);

/* ---------------- one-card-per-visit + idempotency ---------------- */

check(
  'newVisitEntries: only contractions timed after mount become a card',
  eq(
    feed.newVisitEntries(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map((e) => e.id),
    ['c'],
  ),
);
check(
  'newVisitEntries: deletions of older entries never create cards',
  feed.newVisitEntries(new Set(['a', 'b']), [{ id: 'a' }]).length === 0,
);
check(
  'alreadySavedEvent: double-fired completion is a no-op for activity events',
  feed.alreadySavedEvent(
    [{ type: 'activity', deletedAt: null, data: { sessionKey: 'k1' } }],
    'k1',
  ) === true,
);
check(
  'alreadySavedEvent: tombstoned cards do not block a fresh save',
  feed.alreadySavedEvent(
    [{ type: 'activity', deletedAt: '2026-09-21T00:00:00Z', data: { sessionKey: 'k1' } }],
    'k1',
  ) === false,
);
check(
  'alreadySavedEvent: other event types never collide on sessionKey',
  feed.alreadySavedEvent(
    [{ type: 'kick_session', deletedAt: null, data: { sessionKey: 'k1' } }],
    'k1',
  ) === false,
);

/* ---------------- REGRESSION: delete flow uses "log" for everything ---------------- */

const activityEvent = { type: 'activity', data: { sessionKey: 'k1', activityKind: 'contraction' } };
check(
  'deleteKindFor maps the unified Activity card to the activity kind',
  dc.deleteKindFor(activityEvent) === 'activity',
);
const copy = dc.DELETE_COPY[dc.deleteKindFor(activityEvent)];
check('delete dialog title is "Delete this log?"', copy.title === 'Delete this log?', copy.title);
check(
  'delete dialog body is verbatim',
  copy.body === 'This log leaves your story — and your partner’s view too. This can’t be undone.',
  copy.body,
);
check('delete confirm button is "Delete log"', copy.confirmLabel === 'Delete log', copy.confirmLabel);
check('delete toast is "Log deleted — removed from your partner’s view too."', copy.toast === 'Log deleted — removed from your partner’s view too.', copy.toast);
check('delete × label uses "log"', copy.xLabel === 'Delete log', copy.xLabel);

/* ---------------- REGRESSION: Activity filter ---------------- */

const mk = (type: string) => ({ type, data: {} as Record<string, unknown> });
check(
  'Activity filter shows labor activity cards',
  filters.matchesFilter(mk('activity'), 'activity') === true,
);
check(
  'Activity filter excludes kick sessions (they keep their own identity)',
  filters.matchesFilter(mk('kick_session'), 'activity') === false,
);
check(
  'Activity filter excludes ordinary log entries',
  filters.matchesFilter(mk('note'), 'activity') === false,
);
check(
  'Activity filter excludes appointments',
  filters.matchesFilter(mk('appointment'), 'activity') === false,
);
check(
  'Activity cards still appear under All (additive)',
  filters.matchesFilter(mk('activity'), 'all') === true,
);
check(
  'Activity cards still appear under Logs (additive)',
  filters.matchesFilter(mk('activity'), 'logs') === true,
);
check(
  'Activity cards are not reports or appointments',
  filters.matchesFilter(mk('activity'), 'reports') === false &&
    filters.matchesFilter(mk('activity'), 'appointments') === false,
);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nlabor_feed: all checks passed');
