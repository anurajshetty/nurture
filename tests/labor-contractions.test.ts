/**
 * Labor readiness — Section 1 (contraction timer) deterministic tests.
 * Pure logic only — no database, no expo, no network. The source module
 * does import react-native / expo-router / components / src/lib/db for
 * its screen component, so we stub those module loaders before requiring
 * it; the timer math, history derivation, KV persistence, and Week-tab
 * gating helpers never touch them.
 *
 * Coverage: start/stop math (duration, start-to-start interval), history
 * ordering + 6-hour filtering, the quiet 5-1-1 note rule, KV persistence
 * (log / edit clamp / delete), Week-tab gating (34 hidden, 35+ shown),
 * and the centralized medical-copy strings.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/labor-contractions.test.ts app/labor/contractions.tsx \
 *     src/labor/copy.ts src/theme/tokens.ts \
 *     --outDir /tmp/nurture-labor-tests --module commonjs --target es2022 \
 *     --jsx react-jsx --skipLibCheck --esModuleInterop
 *   NODE_PATH=$PWD/node_modules node /tmp/nurture-labor-tests/tests/labor-contractions.test.js
 * (NODE_PATH because the compiled screen pulls react/jsx-runtime at load.)
 */

// `process` comes from @types/node; no redeclare needed.

// Stub module loaders before contractions.tsx loads: its screen component
// imports react-native / expo-router / components / src/lib/db, none of
// which the pure logic needs.
const kvMem = new Map<string, string>();
const nodeModule = require('module');
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: any[]) {
  if (request === 'react-native') {
    return {
      Pressable: 'Pressable',
      StyleSheet: { create: (s: unknown) => s },
      Text: 'Text',
      View: 'View',
    };
  }
  if (request === 'expo-router') {
    return {
      useRouter: () => ({ back() {}, push() {}, replace() {} }),
      useFocusEffect: () => {},
    };
  }
  if (request.includes('lib/db')) {
    return {
      kvGet: (k: string) => (kvMem.has(k) ? kvMem.get(k)! : null),
      kvSet: (k: string, v: string) => {
        kvMem.set(k, v);
      },
      kvDelete: (k: string) => {
        kvMem.delete(k);
      },
      kvClearAll: () => {
        kvMem.clear();
      },
    };
  }
  if (request.includes('/components')) {
    return { Card: 'Card', Screen: 'Screen', BottomSheet: 'BottomSheet' };
  }
  return origLoad.call(this, request, ...rest);
};

const timer = require('../app/labor/contractions') as {
  clampDurationSec: (s: number) => number;
  formatClock: (s: number) => string;
  formatTimeOfDay: (iso: string) => string;
  formatApproxInterval: (s: number) => string;
  durationSecBetween: (a: number, b: number) => number;
  intervalSecBetween: (a: number, b: number) => number;
  readContraction: (raw: unknown) => { id: string; startedAt: string; durationSec: number } | null;
  newContractionId: () => string;
  loadContractions: () => { id: string; startedAt: string; durationSec: number }[];
  logContraction: (e: { id: string; startedAt: string; durationSec: number }) => { id: string; startedAt: string; durationSec: number }[];
  updateContractionDuration: (id: string, s: number) => { id: string; startedAt: string; durationSec: number }[];
  removeContraction: (id: string) => { id: string; startedAt: string; durationSec: number }[];
  recentContractions: (all: { id: string; startedAt: string; durationSec: number }[], nowMs: number) => { id: string; startedAt: string; durationSec: number }[];
  averageIntervalSec: (entries: { id: string; startedAt: string; durationSec: number }[]) => number | null;
  showsFiveOneOneNote: (all: { id: string; startedAt: string; durationSec: number }[], nowMs: number) => boolean;
  historySummary: (all: { id: string; startedAt: string; durationSec: number }[], nowMs: number) => { count: number; lastLabel: string; avgIntervalSec: number | null } | null;
  HISTORY_WINDOW_MS: number;
};

// Raw writer into the stubbed KV store (test scope only).
function kvRawSet(k: string, v: string) {
  kvMem.set(k, v);
}

const copy = require('../src/labor/copy') as {
  LABOR_READINESS_MIN_WEEK: number;
  laborCardVisibleForDisplayedWeek: (w: number) => boolean;
  LABOR_DISCLAIMER: string;
  PROVIDER_DEFERRAL_LINE: string;
  TIMER_COPY: { fiveOneOneLead: string; fiveOneOneBody: string };
};

type E = { id: string; startedAt: string; durationSec: number };

/* ----------------------------- harness ----------------------------- */

let failures = 0;
let count = 0;
function check(name: string, cond: boolean, detail?: string) {
  count++;
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq<T>(name: string, got: T, want: T) {
  check(
    name,
    got === want,
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

const iso = (ms: number) => new Date(ms).toISOString();
function entry(id: string, startMs: number, durationSec: number): E {
  return { id, startedAt: iso(startMs), durationSec };
}

/* -------------------- Week-tab gating (displayed week) -------------- */

eq('gating: LABOR_READINESS_MIN_WEEK is 35', copy.LABOR_READINESS_MIN_WEEK, 35);
check('gating: week 34 hidden', copy.laborCardVisibleForDisplayedWeek(34) === false);
check('gating: week 35 shown', copy.laborCardVisibleForDisplayedWeek(35) === true);
check('gating: week 36 shown', copy.laborCardVisibleForDisplayedWeek(36) === true);
check('gating: end of pregnancy (week 42) shown', copy.laborCardVisibleForDisplayedWeek(42) === true);
check('gating: week 0 hidden', copy.laborCardVisibleForDisplayedWeek(0) === false);
check('gating: negative week hidden', copy.laborCardVisibleForDisplayedWeek(-3) === false);
check('gating: fractional week hidden', copy.laborCardVisibleForDisplayedWeek(35.5) === false);
check('gating: NaN hidden', copy.laborCardVisibleForDisplayedWeek(Number.NaN) === false);

/* ------------------------- timer math ------------------------------- */

eq('clock: 0 → 0:00', timer.formatClock(0), '0:00');
eq('clock: 47 → 0:47', timer.formatClock(47), '0:47');
eq('clock: 62 → 1:02', timer.formatClock(62), '1:02');
eq('clock: 3600 → 60:00', timer.formatClock(3600), '60:00');
eq('clock: negative clamps to 0:00', timer.formatClock(-5), '0:00');

eq(
  'duration: 62s start→stop',
  timer.durationSecBetween(1_000_000, 1_062_000),
  62,
);
eq(
  'duration: zero-length floors at 1s',
  timer.durationSecBetween(1_000_000, 1_000_000),
  1,
);
eq(
  'interval: start-to-start 5:08',
  timer.intervalSecBetween(1_000_000, 1_308_000),
  308,
);
eq(
  'interval: identical starts → 0',
  timer.intervalSecBetween(1_000_000, 1_000_000),
  0,
);

check(
  'time-of-day formats device-local',
  /^\d{1,2}:\d{2} [AP]M$/.test(timer.formatTimeOfDay(iso(Date.now()))),
);
eq('time-of-day: garbage → empty', timer.formatTimeOfDay('nope'), '');
eq('approx: 60s → about a minute', timer.formatApproxInterval(60), 'about a minute');
eq('approx: 300s → about 5 minutes', timer.formatApproxInterval(300), 'about 5 minutes');

/* --------------------- tolerant entry parsing ----------------------- */

const good = timer.readContraction({ id: 'a', startedAt: iso(1000), durationSec: 62 });
check('read: valid entry parses', good !== null && good.id === 'a' && good.durationSec === 62);
eq('read: {} → null', timer.readContraction({}), null);
eq('read: string → null', timer.readContraction('x'), null);
eq('read: null → null', timer.readContraction(null), null);
eq('read: bad date → null', timer.readContraction({ id: 'a', startedAt: 'x', durationSec: 5 }), null);
eq('read: missing id → null', timer.readContraction({ startedAt: iso(1), durationSec: 5 }), null);
eq('read: NaN duration → null', timer.readContraction({ id: 'a', startedAt: iso(1), durationSec: Number.NaN }), null);
check('read: ids are unique strings', timer.newContractionId() !== timer.newContractionId());

/* ------------------ history: window + ordering ---------------------- */

const now = Date.now();
const min = 60_000;
const seeded: E[] = [
  entry('new', now - 5 * min, 62),
  entry('mid', now - 10 * min, 58),
  entry('old', now - 7 * 3_600_000, 55), // 7h ago — outside the window
  entry('future', now + 10 * min, 55), // future-dated — excluded
];
const recent = timer.recentContractions(seeded, now);
eq('recent: keeps only in-window entries', recent.length, 2);
eq('recent: newest first', recent[0].id, 'new');
eq('recent: second is mid', recent[1].id, 'mid');
check(
  'recent: window is six hours',
  timer.HISTORY_WINDOW_MS === 6 * 3600_000,
);

eq(
  'avg interval: two 5-min-apart entries → 300',
  timer.averageIntervalSec([entry('a', 1_300_000, 60), entry('b', 1_000_000, 60)]),
  300,
);
eq('avg interval: single entry → null', timer.averageIntervalSec([entry('a', 1000, 60)]), null);
eq('avg interval: empty → null', timer.averageIntervalSec([]), null);

const sum = timer.historySummary([entry('a', now - 5 * min, 62), entry('b', now - 10 * min, 58)], now);
check('summary: present when entries exist', sum !== null);
eq('summary: count', sum?.count, 2);
eq('summary: avg interval', sum?.avgIntervalSec, 300);
check(
  'summary: last label is the latest time',
  sum?.lastLabel === timer.formatTimeOfDay(iso(now - 5 * min)),
);
eq('summary: empty → null', timer.historySummary([], now), null);

/* -------------------- the quiet 5-1-1 note rule --------------------- */

const patterned: E[] = [
  entry('p5', now - 1 * min, 60),
  entry('p4', now - 6 * min, 58),
  entry('p3', now - 11 * min, 62),
  entry('p2', now - 16 * min, 55),
  entry('p1', now - 21 * min, 61),
];
check('5-1-1: pattern emerged (5 entries ~5 min apart) → shown', timer.showsFiveOneOneNote(patterned, now) === true);
check(
  '5-1-1: only 2 entries → hidden',
  timer.showsFiveOneOneNote(patterned.slice(0, 2), now) === false,
);
check(
  '5-1-1: wide apart (30 min) → hidden',
  timer.showsFiveOneOneNote(
    [entry('a', now - 1 * min, 60), entry('b', now - 31 * min, 60), entry('c', now - 61 * min, 60)],
    now,
  ) === false,
);
check('5-1-1: empty → hidden', timer.showsFiveOneOneNote([], now) === false);

/* ------------------------- KV persistence --------------------------- */

kvMem.clear();
eq('persist: starts empty', timer.loadContractions().length, 0);
const e1 = entry(timer.newContractionId(), now - 3 * min, 62);
let all = timer.logContraction(e1);
eq('persist: log returns 1 entry', all.length, 1);
eq('persist: load reads it back', timer.loadContractions().length, 1);
eq('persist: id round-trips', timer.loadContractions()[0].id, e1.id);

const e2 = entry(timer.newContractionId(), now - 1 * min, 55);
all = timer.logContraction(e2);
eq('persist: newest first after second log', timer.loadContractions()[0].id, e2.id);

all = timer.updateContractionDuration(e2.id, 125);
eq('persist: edit snaps to 5s steps (125 → 125)', timer.loadContractions()[0].durationSec, 125);
all = timer.updateContractionDuration(e2.id, 3);
eq('persist: edit clamps below 5s', timer.loadContractions()[0].durationSec, 5);
all = timer.updateContractionDuration(e2.id, 9999);
eq('persist: edit clamps above 10 min', timer.loadContractions()[0].durationSec, 600);
check('persist: edit keeps other entries', timer.loadContractions().length === 2);

all = timer.removeContraction(e2.id);
eq('persist: delete removes it', timer.loadContractions().length, 1);
eq('persist: delete keeps the other', timer.loadContractions()[0].id, e1.id);

kvRawSet('labor.contractions.v1', 'not-json{{');
eq('persist: corrupt JSON loads as empty', timer.loadContractions().length, 0);
kvMem.clear();

/* --------------------- centralized medical copy --------------------- */

eq(
  'copy: disclaimer exact',
  copy.LABOR_DISCLAIMER,
  "This isn't medical advice — your care team knows your situation best.",
);
eq(
  'copy: 5-1-1 lead exact',
  copy.TIMER_COPY.fiveOneOneLead,
  'A quiet note:',
);
eq(
  'copy: 5-1-1 body exact (final)',
  copy.TIMER_COPY.fiveOneOneBody,
  'many providers mention 5-1-1 — yours comes first.',
);
eq(
  'copy: provider deferral line exact (final)',
  copy.PROVIDER_DEFERRAL_LINE,
  "Questions about what's right for you belong with your provider or a pelvic-floor physical therapist.",
);
check(
  'copy: no triage language anywhere in timer copy',
  !/go to (the )?hospital|you may be in labor|call your (doctor|provider)|emergency/i.test(
    JSON.stringify(copy.TIMER_COPY),
  ),
);

/* ------------------------------ report ------------------------------ */

if (failures > 0) {
  console.error(`\n${failures} of ${count} checks failed.`);
  process.exit(1);
}
console.log(`ok — ${count} checks passed.`);
