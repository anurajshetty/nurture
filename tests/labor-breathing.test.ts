/**
 * Unit tests: labor-readiness breathing pacer logic (Willow, Sept 2026).
 *
 * Pure logic only — no network, no React Native. Covers the pacer state
 * machine and pattern sequencing that the UI (app/labor/breathing.tsx +
 * src/labor/breathing/Pacer.tsx) drives:
 * - phase sequencing per pattern (opening/closing cleansing breaths, reps,
 *   labels, breath kinds)
 * - timing: ~1-minute rounds, phase lookup, countdown labels
 * - start/stop state machine: idle -> running -> done, gentle end -> idle
 * - medical-copy guards: exact disclaimer/intro lines, and the hard rule
 *   that no pattern-triggered alert copy may appear in this section
 *
 * Run with:
 *
 *   npx tsc tests/labor-breathing.test.ts src/labor/breathing/patterns.ts \
 *     --outDir /tmp/nurture-labor-breath-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-labor-breath-tests/tests/labor-breathing.test.js
 */
import {
  BANNED_ALERT_PHRASES,
  BREATHING_INTRO_COPY,
  MEDICAL_DISCLAIMER,
  PATTERNS,
  buildSeq,
  formatTimeLeft,
  pacerReducer,
  phaseAtElapsed,
  roundDurationMs,
  tickView,
  type PacerMachine,
} from '../src/labor/breathing/patterns';

declare const process: { exit(code: number): void };

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}
const secs = (seq: ReturnType<typeof buildSeq>) => roundDurationMs(seq) / 1000;

/* ---------- cleanse: standalone 6-rep practice, no wrap ---------- */
{
  const seq = buildSeq('cleanse');
  check('cleanse has 12 phases (6 reps x in/out)', seq.length === 12);
  check('cleanse every phase tagged with the pattern name', seq.every((p) => p.tag === 'Cleansing breath'));
  check('cleanse alternates in/out', seq.every((p, i) => (i % 2 === 0 ? p.kind === 'in' : p.kind === 'out')));
  check('cleanse in=4s out=6s', seq[0].s === 4 && seq[1].s === 6);
  check('cleanse round is 60s', secs(seq) === 60);
}

/* ---------- slow: opening + 4 reps + closing = 60s ---------- */
{
  const seq = buildSeq('slow');
  check('slow opens with a cleansing breath in/out', seq[0].label === 'breathe in\u2026' && seq[0].s === 4 && seq[1].s === 6);
  check('slow opening tagged', seq[0].tag === 'Opening cleansing breath' && seq[1].tag === 'Opening cleansing breath');
  check('slow closes with a cleansing breath', seq[seq.length - 2].tag === 'Closing cleansing breath' && seq[seq.length - 1].tag === 'Closing cleansing breath');
  const middle = seq.slice(2, seq.length - 2);
  check('slow middle is 4 reps of the loop', middle.length === 8 && middle.every((p) => p.tag === 'Slow-paced breathing'));
  check('slow round is 60s', secs(seq) === 60);
}

/* ---------- light: 10 reps ---------- */
{
  const seq = buildSeq('light');
  const middle = seq.slice(2, seq.length - 2);
  check('light middle is 10 reps (2s phases)', middle.length === 20 && middle.every((p) => p.s === 2));
  check('light round is 60s', secs(seq) === 60);
}

/* ---------- patterned: hee/hee/hoo/rest ---------- */
{
  const seq = buildSeq('patterned');
  const middle = seq.slice(2, seq.length - 2);
  check('patterned reps = 7', middle.length === 28);
  const rep = middle.slice(0, 4);
  check(
    'patterned rep labels',
    rep[0].label === 'hee\u2026' && rep[1].label === 'hee\u2026' && rep[2].label === 'hoo\u2026' && rep[3].label === 'rest\u2026',
  );
  check(
    'patterned rep kinds',
    rep[0].kind === 'in' && rep[1].kind === 'out' && rep[2].kind === 'out' && rep[3].kind === 'hold',
  );
  check('patterned hoo is 3s', rep[2].s === 3);
  check('patterned round is 62s', secs(seq) === 62);
}

/* ---------- speedScale ---------- */
{
  const seq = buildSeq('slow', 2);
  check('speedScale halves every phase', secs(seq) === 30 && seq[0].s === 2);
}

/* ---------- phase lookup ---------- */
{
  const seq = buildSeq('slow');
  const a = phaseAtElapsed(seq, 0);
  check('t=0 is phase 0', a.index === 0 && !a.done && a.phase?.label === 'breathe in\u2026');
  const b = phaseAtElapsed(seq, 4000);
  check('t=4s crosses into the out phase', b.index === 1 && b.phase?.kind === 'out');
  const c = phaseAtElapsed(seq, 59999);
  check('t=59.999s is the last phase', c.index === seq.length - 1 && !c.done);
  const d = phaseAtElapsed(seq, 60000);
  check('t=60s is done', d.done && d.phase === null);
  const e = phaseAtElapsed(seq, 120000);
  check('way past total is done', e.done);
}

/* ---------- tick view ---------- */
{
  const seq = buildSeq('slow');
  const t0 = 1_000_000;
  const v = tickView(seq, t0, t0);
  check('tick at start: phase 0, 4s left', v.phaseIndex === 0 && v.phaseSecondsLeft === 4 && !v.done);
  check('tick at start: total label 0:60 left', v.totalLeftLabel === '0:60 left');
  check('tick at start: progress 0', v.progress === 0);
  const mid = tickView(seq, t0, t0 + 53_000);
  check('tick at 53s: total label 0:07 left', mid.totalLeftLabel === '0:07 left');
  check('tick at 53s: in the closing breath', mid.tag === 'Closing cleansing breath');
  check('tick progress is fractional', mid.progress > 0.8 && mid.progress < 1);
  const end = tickView(seq, t0, t0 + 60_000);
  check('tick at total: done, progress 1', end.done && end.progress === 1);
}

check('formatTimeLeft pads single digits', formatTimeLeft(7000) === '0:07 left');
check('formatTimeLeft handles 0', formatTimeLeft(0) === '0:00 left');

/* ---------- state machine: start / tick / gentle end ---------- */
{
  const idle: PacerMachine = { phase: 'idle' };
  const t0 = 5_000_000;
  const running = pacerReducer(idle, { type: 'start', patternId: 'light', nowMs: t0 });
  check('start: idle -> running with a fresh seq', running.phase === 'running' && running.patternId === 'light');
  if (running.phase === 'running') {
    check('start: seq matches buildSeq', running.seq.length === buildSeq('light').length);
    check('start: startedAtMs recorded', running.startedAtMs === t0);
  }
  const still = pacerReducer(running, { type: 'tick', nowMs: t0 + 30_000 });
  check('tick mid-round stays running', still.phase === 'running');
  const done = pacerReducer(running, { type: 'tick', nowMs: t0 + 60_000 });
  check('tick at total -> done', done.phase === 'done' && done.patternId === 'light');
  const ended = pacerReducer(running, { type: 'end' });
  check('end mid-round -> idle (gentle stop)', ended.phase === 'idle');
  const restarted = pacerReducer(done, { type: 'start', patternId: 'slow', nowMs: t0 + 61_000 });
  check('start from done restarts', restarted.phase === 'running' && restarted.patternId === 'slow');
  const backToList = pacerReducer(done, { type: 'end' });
  check('end from done -> idle', backToList.phase === 'idle');
  const tickIdle = pacerReducer(idle, { type: 'tick', nowMs: t0 });
  check('tick on idle is a no-op', tickIdle.phase === 'idle');
}

/* ---------- medical copy guards ---------- */
{
  check(
    'disclaimer is the exact approved line',
    MEDICAL_DISCLAIMER === 'This isn\u2019t medical advice \u2014 your care team knows your situation best.',
  );
  check(
    'intro is the exact approved line',
    BREATHING_INTRO_COPY ===
      'Breathing patterns many parents practice for labor. There\u2019s no single right way to breathe \u2014 practice now and notice what feels best.',
  );
  const allCopy = [
    MEDICAL_DISCLAIMER,
    BREATHING_INTRO_COPY,
    ...Object.values(PATTERNS).flatMap((p) => [p.name, p.tag, p.desc]),
  ].join(' ').toLowerCase();
  for (const banned of BANNED_ALERT_PHRASES) {
    check(`hard rule: no "${banned}" in this section`, !allCopy.includes(banned));
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('\nall labor-breathing tests passed');
}
