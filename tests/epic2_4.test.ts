/**
 * Epic 2.4 deterministic tests: continuous dictation chaining.
 *
 * The speech module is INJECTED (deps.module) — a fake whose events the
 * test drives directly. No microphone, no network, no Expo runtime.
 * These tests prove the stitching/restart state machine; they do NOT
 * prove real multi-minute OS behavior (Anuraj's hand test does that).
 *
 * Run with:
 *
 *   npx tsc tests/epic2_4.test.ts src/composer/voice.ts \
 *     --outDir /tmp/nurture-tests24 --module commonjs --target es2022 \
 *     --lib es2022,dom --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests24/tests/epic2_4.test.js
 */

import {
  startDictation,
  stitchTranscript,
  DICTATION_CAP_MS,
  type VoiceCallbacks,
  type VoiceDeps,
} from '../src/composer/voice';

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
    console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fake speech module: the test drives 'result' / 'error' / 'end' by hand. */
function makeFakeModule() {
  const listeners = new Map<string, Array<(e: any) => void>>();
  const fake = {
    startCount: 0,
    stopCount: 0,
    abortCount: 0,
    removedListeners: 0,
    throwOnNextStart: false,
    async requestPermissionsAsync() {
      return { granted: true };
    },
    start(_options: unknown) {
      if (fake.throwOnNextStart) {
        fake.throwOnNextStart = false;
        throw new Error('busy');
      }
      fake.startCount += 1;
    },
    stop() {
      fake.stopCount += 1;
    },
    abort() {
      fake.abortCount += 1;
    },
    addListener(event: string, handler: (e: any) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return {
        remove() {
          fake.removedListeners += 1;
          const l = listeners.get(event) ?? [];
          const i = l.indexOf(handler);
          if (i >= 0) l.splice(i, 1);
        },
      };
    },
    emit(event: string, payload: any) {
      for (const h of [...(listeners.get(event) ?? [])]) h(payload);
    },
  };
  return fake;
}

type FakeModule = ReturnType<typeof makeFakeModule>;

function makeCallbacks() {
  const cb: VoiceCallbacks & {
    interims: string[];
    finals: string[];
    errors: string[];
    limits: string[];
  } = {
    interims: [],
    finals: [],
    errors: [],
    limits: [],
    onInterim: (t) => cb.interims.push(t),
    onFinal: (t) => cb.finals.push(t),
    onError: (m) => cb.errors.push(m),
    onLimitReached: (m) => cb.limits.push(m),
  };
  return cb;
}

function depsFor(fake: FakeModule, extra?: Partial<VoiceDeps>): VoiceDeps {
  return {
    module: fake as unknown as VoiceDeps['module'],
    restartDelayMs: 20,
    ...extra,
  };
}

async function main(): Promise<void> {
  // --- stitchTranscript: pure helper ---
  check('stitch empty base', stitchTranscript('', 'hello world'), 'hello world');
  check('stitch empty addition', stitchTranscript('hello', ''), 'hello');
  check(
    'stitch overlap dedup',
    stitchTranscript('hello world', 'world again'),
    'hello world again',
  );
  check(
    'stitch multi-word overlap',
    stitchTranscript('I felt sick after lunch', 'after lunch and rested'),
    'I felt sick after lunch and rested',
  );
  check(
    'stitch no overlap',
    stitchTranscript('hello', 'goodbye'),
    'hello goodbye',
  );
  check(
    'stitch collapses whitespace',
    stitchTranscript('hello world', 'world   again\ntoday'),
    'hello world again today',
  );

  // --- Chained sessions: finals commit, interims replace the tail,
  //     OS-initiated end restarts, no duplication at the seam ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    const session = await startDictation(cb, depsFor(fake));
    check('chained: session returned', session !== null, true);

    fake.emit('result', { isFinal: false, results: [{ transcript: 'hello' }] });
    fake.emit('result', { isFinal: false, results: [{ transcript: 'hello world' }] });
    check('chained: interim replaces tail', cb.interims.at(-1), 'hello world');

    fake.emit('result', { isFinal: true, results: [{ transcript: 'hello world' }] });
    check('chained: final committed', cb.interims.at(-1), 'hello world');

    // A late interim repeating the boundary words dedups, not duplicates.
    fake.emit('result', { isFinal: false, results: [{ transcript: 'hello world again' }] });
    check('chained: seam dedup on interim', cb.interims.at(-1), 'hello world again');

    // OS ends the session on its own -> a fresh session must start.
    fake.emit('end', {});
    await sleep(60);
    check('chained: restarted after OS end', fake.startCount, 2);

    fake.emit('result', { isFinal: false, results: [{ transcript: 'hello world again today' }] });
    check('chained: interim after restart', cb.interims.at(-1), 'hello world again today');
    fake.emit('result', { isFinal: true, results: [{ transcript: 'hello world again today I rested' }] });
    check('chained: second final appended', cb.interims.at(-1), 'hello world again today I rested');

    // User stop -> final lands, NO further restart.
    session!.stop();
    fake.emit('end', {});
    await sleep(60);
    check('chained: onFinal once', cb.finals.length, 1);
    check('chained: final transcript complete', cb.finals[0], 'hello world again today I rested');
    check('chained: no restart after user stop', fake.startCount, 2);
    check('chained: no error surfaced', cb.errors.length, 0);
    check('chained: listeners cleaned up', fake.removedListeners >= 3, true);
  }

  // --- Error ends dictation without restart ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    await startDictation(cb, depsFor(fake));
    fake.emit('result', { isFinal: false, results: [{ transcript: 'some words' }] });
    fake.emit('error', { error: 'network' });
    await sleep(60);
    check('error: kind message', cb.errors.length, 1);
    check('error: no restart', fake.startCount, 1);
    check('error: no final', cb.finals.length, 0);
  }

  // --- 'aborted' error stays silent (our own teardown) ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    const session = await startDictation(cb, depsFor(fake));
    session!.abort();
    fake.emit('error', { error: 'aborted' });
    fake.emit('end', {});
    await sleep(40);
    check('abort: silent', cb.errors.length + cb.finals.length, 0);
    check('abort: module.abort called', fake.abortCount, 1);
  }

  // --- Repeated empty sessions give up kindly ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    await startDictation(cb, depsFor(fake));
    fake.emit('end', {});
    await sleep(40);
    fake.emit('end', {});
    await sleep(40);
    fake.emit('end', {});
    await sleep(40);
    check('no-speech: gave up after 3 empty sessions', fake.startCount, 3);
    check('no-speech: kind message', cb.errors, ['Didn’t catch that — try again or type it instead.']);
    check('no-speech: no final', cb.finals.length, 0);
  }

  // --- Sessions WITH results keep chaining past the empty budget ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    await startDictation(cb, depsFor(fake));
    for (let i = 0; i < 5; i += 1) {
      fake.emit('result', { isFinal: false, results: [{ transcript: `chunk ${i}` }] });
      fake.emit('end', {});
      await sleep(40);
    }
    check('nonempty: kept chaining', fake.startCount, 6);
    check('nonempty: no error', cb.errors.length, 0);
  }

  // --- Safety cap: graceful stop, transcript preserved, kind message ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    await startDictation(cb, depsFor(fake, { capMs: 150, restartDelayMs: 10 }));
    fake.emit('result', { isFinal: false, results: [{ transcript: 'ten minutes of talking' }] });
    await sleep(200); // cap fires -> stop() -> OS 'end'
    fake.emit('end', {});
    await sleep(40);
    check('cap: final delivered', cb.finals, ['ten minutes of talking']);
    check('cap: limit message shown', cb.limits.length, 1);
    check('cap: no restart after cap', fake.startCount, 1);
    check('cap: default constant is 10 minutes', DICTATION_CAP_MS, 10 * 60 * 1000);
  }

  // --- Rapid stop/restart race: synchronous start throw retries ---
  {
    const fake = makeFakeModule();
    const cb = makeCallbacks();
    fake.throwOnNextStart = true;
    const session = await startDictation(cb, depsFor(fake));
    check('busy: session still returned', session !== null, true);
    await sleep(1000); // backoff retry
    fake.emit('result', { isFinal: true, results: [{ transcript: 'recovered after busy' }] });
    session!.stop();
    fake.emit('end', {});
    await sleep(40);
    check('busy: recovered transcript', cb.finals, ['recovered after busy']);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
