/**
 * Unit tests: pelvic-floor relaxation session state machine
 * (mockup 29, Anuraj Sept 2026).
 *
 * Pure logic only — no network, no SQLite, no timers. Run with:
 *
 *   npx tsc --ignoreConfig tests/labor-pelvicfloor.test.ts \
 *     src/labor/pelvicfloor/exercises.ts \
 *     --outDir /tmp/nurture-pf-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-pf-tests/tests/labor-pelvicfloor.test.js
 */
import {
  currentPhase,
  dotStates,
  EXERCISE_ORDER,
  EXERCISES,
  restartSession,
  startSession,
  tickSession,
  totalSessionSecs,
} from '../src/labor/pelvicfloor/exercises';

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
function eq<T>(name: string, a: T, b: T) {
  check(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

// --- config sanity (mirrors the mockup's EX table) ---
check('four exercises in order', EXERCISE_ORDER.join(',') === 'breath,reverse,visual,positions');
for (const id of EXERCISE_ORDER) {
  const ex = EXERCISES[id];
  check(`${id} has a title`, ex.title.length > 0);
  eq(`${id} rounds`, ex.rounds, 4);
  eq(`${id} phase count`, ex.phases.length, 2);
  check(`${id} all phases have positive secs`, ex.phases.every((p) => p.secs > 0));
  eq(`${id} total secs (4+6)*4`, totalSessionSecs(ex), 40);
}
eq('breath phase 1', currentPhase(startSession('breath')).label, 'breathe in…');
eq('reverse phase 2', EXERCISES.reverse.phases[1].label, 'gently release…');

// --- startSession ---
{
  const s = startSession('visual');
  eq('start round 1', s.round, 1);
  eq('start phaseIndex 0', s.phaseIndex, 0);
  eq('start remaining = phase secs', s.remaining, 4);
  eq('start status running', s.status, 'running');
}

// --- tick sequencing within a phase ---
{
  let s = startSession('breath');
  s = tickSession(s);
  eq('after 1 tick remaining 3', s.remaining, 3);
  eq('still phase 0', s.phaseIndex, 0);
  eq('still round 1', s.round, 1);
  eq('still running', s.status, 'running');
}

// --- phase advance ---
{
  let s = startSession('breath');
  for (let i = 0; i < 4; i++) s = tickSession(s);
  eq('phase advances after 4 ticks', s.phaseIndex, 1);
  eq('phase 2 label', currentPhase(s).label, 'let it go…');
  eq('phase 2 remaining reset', s.remaining, 6);
}

// --- round advance ---
{
  let s = startSession('breath');
  for (let i = 0; i < 10; i++) s = tickSession(s);
  eq('round 2 after 10 ticks', s.round, 2);
  eq('phase resets to 0', s.phaseIndex, 0);
  eq('phase 1 secs again', s.remaining, 4);
}

// --- completion: status flips to done after all rounds ---
{
  let s = startSession('reverse');
  for (let i = 0; i < 40; i++) s = tickSession(s);
  eq('done after 40 ticks', s.status, 'done');
  eq('remaining 0 at done', s.remaining, 0);
  const again = tickSession(s);
  eq('tick after done is a no-op', again.status, 'done');
}

// --- dot states ---
{
  let s = startSession('breath');
  check('dots start: now,todo,todo,todo', dotStates(s).join(',') === 'now,todo,todo,todo');
  for (let i = 0; i < 10; i++) s = tickSession(s);
  check('dots round 2: done,now,todo,todo', dotStates(s).join(',') === 'done,now,todo,todo');
  for (let i = 0; i < 30; i++) s = tickSession(s);
  check('dots done: all done', dotStates(s).join(',') === 'done,done,done,done');
}

// --- restart ---
{
  let s = startSession('positions');
  for (let i = 0; i < 25; i++) s = tickSession(s);
  const r = restartSession(s);
  eq('restart back to round 1', r.round, 1);
  eq('restart back to phase 0', r.phaseIndex, 0);
  eq('restart same exercise', r.config.id, 'positions');
  eq('restart running', r.status, 'running');
}

// --- immutability: tick never mutates the input ---
{
  const s = startSession('breath');
  const before = { ...s };
  tickSession(s);
  check(
    'tick is pure (input unchanged)',
    s.remaining === before.remaining && s.phaseIndex === before.phaseIndex,
  );
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('all pelvic-floor session tests passed');
}
