/**
 * Epic 2 deterministic tests: intent detection, mood-pill window, and
 * end-of-day nudge decision logic. Pure modules only — no database,
 * no notifications, no network. Run with:
 *
 *   npx tsc tests/epic2.test.ts src/composer/intent.ts \
 *     src/composer/moodWindow.ts src/notifications/nudgeLogic.ts \
 *     --outDir /tmp/nurture-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests/tests/epic2.test.js
 */

import { detectIntents } from '../src/composer/intent';
import { isMoodWindowElapsed, MOOD_WINDOW_MS } from '../src/composer/moodWindow';
import {
  decideNudge,
  inQuietHours,
  parseHM,
  type NudgeInput,
} from '../src/notifications/nudgeLogic';

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

// ---------- intent detection ----------

{
  const p = detectIntents('Heartburn after lunch today');
  check('heartburn → one proposal', p.length, 1);
  check('heartburn → kind', p[0]?.kind, 'symptom');
  check('heartburn → title', p[0]?.title, 'Save as symptom?');
  check('heartburn → labels', p[0]?.labels, ['Heartburn']);
}

{
  const p = detectIntents('Felt flutters all morning, so magical');
  check('flutters → one proposal', p.length, 1);
  check('flutters → kind', p[0]?.kind, 'movement');
  check('flutters → title', p[0]?.title, 'Save as a milestone?');
}

{
  const p = detectIntents('Had a lovely walk in the park');
  check('no triggers → no proposals', p.length, 0);
}

{
  const p = detectIntents('Went kickboxing with Maya');
  check('kickboxing ≠ kicks (word boundary)', p.length, 0);
}

{
  const p = detectIntents('Woke up with a headache and nausea again');
  check('two symptoms → one proposal', p.length, 1);
  check('two symptoms → both labels', p[0]?.labels, ['Nausea', 'Headache']);
}

{
  const p = detectIntents('Weighed 148 lbs this morning');
  check('weight → proposal', p.length, 1);
  check('weight → kind', p[0]?.kind, 'weight');
  check('weight → labels', p[0]?.labels, ['148 lb']);
  const ev = p[0]!.buildEvent('Weighed 148 lbs this morning');
  check('weight → event type', ev.type, 'weight');
  check('weight → event data', ev.data, {
    value: 148,
    unit: 'lb',
    note: 'Weighed 148 lbs this morning',
  });
}

{
  const p = detectIntents('Stepped on the scale: 68 kg');
  check('weight kg → unit', p[0]?.labels, ['68 kg']);
}

{
  const p = detectIntents('Ultrasound appointment Thursday at 10');
  check('appointment → proposal', p.length, 1);
  check('appointment → kind', p[0]?.kind, 'appointment');
  check('appointment → title', p[0]?.title, 'Save as appointment?');
}

{
  // Detection must never create anything on its own: buildEvent is only
  // invoked from the explicit Save tap, so merely calling detectIntents
  // must leave the event unbuilt (we assert the proposal exists but no
  // event was produced without calling buildEvent — nothing to call).
  const p = detectIntents('terrible backache tonight');
  check('detection is proposal-only', p.length, 1);
  check('detection → kind', p[0]?.kind, 'symptom');
}

// ---------- mood pill window ----------

{
  const now = Date.now();
  check('never logged → show pill', isMoodWindowElapsed(null, now), true);
  check('logged 5h ago → show pill', isMoodWindowElapsed(now - 5 * 3600_000, now), true);
  check('logged 3h ago → hide pill', isMoodWindowElapsed(now - 3 * 3600_000, now), false);
  check('logged exactly 4h ago → hide pill (strict >)', isMoodWindowElapsed(now - MOOD_WINDOW_MS, now), false);
  check('window is 4 hours', MOOD_WINDOW_MS, 4 * 3600 * 1000);
}

// ---------- nudge time parsing ----------

{
  check('parse 20:30', parseHM('20:30'), { h: 20, m: 30 });
  check('parse 08:05', parseHM('08:05'), { h: 8, m: 5 });
  check('reject 12h clock', parseHM('8:30 PM'), null);
  check('reject hour 25', parseHM('25:00'), null);
  check('reject minute 60', parseHM('20:60'), null);
  check('reject empty', parseHM(''), null);
}

// ---------- quiet hours ----------

{
  check('20:30 outside 21:00–08:00', inQuietHours({ h: 20, m: 30 }, '21:00', '08:00'), false);
  check('21:00 inside 21:00–08:00', inQuietHours({ h: 21, m: 0 }, '21:00', '08:00'), true);
  check('02:00 inside 21:00–08:00', inQuietHours({ h: 2, m: 0 }, '21:00', '08:00'), true);
  check('07:59 inside 21:00–08:00', inQuietHours({ h: 7, m: 59 }, '21:00', '08:00'), true);
  check('08:00 outside 21:00–08:00 (end exclusive)', inQuietHours({ h: 8, m: 0 }, '21:00', '08:00'), false);
  check('22:30 inside 22:00–23:00', inQuietHours({ h: 22, m: 30 }, '22:00', '23:00'), true);
  check('23:00 outside 22:00–23:00 (end exclusive)', inQuietHours({ h: 23, m: 0 }, '22:00', '23:00'), false);
}

// ---------- nudge decision ----------

const base: NudgeInput = {
  enabled: true,
  paused: false,
  hasEntryToday: false,
  time: '20:30',
  quietStart: '21:00',
  quietEnd: '08:00',
  permissionGranted: true,
};

{
  check('happy path → 20:30 plan', decideNudge(base), { hour: 20, minute: 30 });
  check('disabled → null', decideNudge({ ...base, enabled: false }), null);
  check('paused → null', decideNudge({ ...base, paused: true }), null);
  check('entry logged → null (never nag)', decideNudge({ ...base, hasEntryToday: true }), null);
  check('bad time → null', decideNudge({ ...base, time: 'whenever' }), null);
  check('time in quiet hours → null', decideNudge({ ...base, time: '22:00' }), null);
  check('no permission → null', decideNudge({ ...base, permissionGranted: false }), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
