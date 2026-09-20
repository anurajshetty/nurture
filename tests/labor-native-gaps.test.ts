/**
 * Unit tests: labor-readiness native gaps (Willow, Sept 2026).
 *
 * Covers the Platform branching added so the labor sections actually work on
 * native iOS instead of being silent no-ops:
 *
 * - src/labor/keepAwake.ts — shared wake lock. On web (Platform.OS === 'web')
 *   it must use the Web Wake Lock API (`navigator.wakeLock.request('screen')`,
 *   re-requested on visibility return, released on cleanup); on native it must
 *   call expo-keep-awake's activate/deactivate with matching tags. Every path
 *   is best-effort and must never throw.
 * - src/labor/breathing/tone.ts and src/labor/pelvicfloor/device.ts — soft
 *   tones. On web they must NOT touch expo-audio; on native they must play
 *   their (distinct) bundled chime assets through expo-audio and never throw.
 *   The native audio session must RESPECT the iPhone silent switch
 *   (Anuraj's decision, Sept 20 2026): the audio mode must explicitly set
 *   `playsInSilentMode: false` — expo-audio v57 defaults it to `true`, so
 *   merely omitting the call would not mute the chimes.
 *
 * Pure node — react-native / expo-keep-awake / expo-audio / .wav assets are
 * stubbed via the module loader before the sources load.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/labor-native-gaps.test.ts src/labor/keepAwake.ts \
 *     src/labor/nativeChime.ts src/labor/breathing/tone.ts \
 *     src/labor/pelvicfloor/device.ts src/lib/audio.d.ts \
 *     --outDir /tmp/nurture-labor-native-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-labor-native-tests/tests/labor-native-gaps.test.js
 */

// `process` comes from @types/node; no redeclare needed.

/* ---------------- module-loader stubs (before sources load) ---------------- */

const platformStub = { OS: 'web' };

const keepAwakeCalls: Array<{ fn: string; tag?: string }> = [];
const keepAwakeStub = {
  activateKeepAwakeAsync: async (tag?: string) => {
    keepAwakeCalls.push({ fn: 'activate', tag });
  },
  deactivateKeepAwake: async (tag?: string) => {
    keepAwakeCalls.push({ fn: 'deactivate', tag });
  },
};

const madePlayers: Array<{
  asset: unknown;
  playCalls: number;
  seekCalls: number;
  play(): void;
  seekTo(s: number): Promise<void>;
}> = [];
const audioModeCalls: unknown[] = [];
let audioCreateThrows = false;
const audioStub = {
  createAudioPlayer: (asset: unknown) => {
    if (audioCreateThrows) throw new Error('no audio device');
    const p = {
      asset,
      playCalls: 0,
      seekCalls: 0,
      play() {
        p.playCalls++;
      },
      async seekTo(_s: number) {
        p.seekCalls++;
      },
    };
    madePlayers.push(p);
    return p;
  },
  setAudioModeAsync: async (mode: unknown) => {
    audioModeCalls.push(mode);
  },
};

// Distinct fake ids for the two chime assets (sound design stays distinct).
const BREATH_WAV = 39201;
const PELVIC_WAV = 52301;

const nodeModule = require('module');
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: any[]) {
  if (request === 'react-native') return { Platform: platformStub };
  if (request === 'expo-keep-awake') return keepAwakeStub;
  if (request === 'expo-audio') return audioStub;
  if (request.endsWith('chime-breathing.wav')) return BREATH_WAV;
  if (request.endsWith('chime-pelvicfloor.wav')) return PELVIC_WAV;
  return origLoad.call(this, request, ...rest);
};

const { requestScreenWakeLock } = require('../src/labor/keepAwake');
const { playSoftTone: playBreathTone } = require('../src/labor/breathing/tone');
const { playSoftTone: playPelvicTone } = require('../src/labor/pelvicfloor/device');

/* ---------------- tiny harness ---------------- */

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 10));
function reset() {
  keepAwakeCalls.length = 0;
  madePlayers.length = 0;
  audioModeCalls.length = 0;
  audioCreateThrows = false;
  delete (globalThis as any).navigator;
  delete (globalThis as any).document;
}

async function main() {
  /* ---------- keepAwake: web path uses the Wake Lock API ---------- */
  {
    reset();
    platformStub.OS = 'web';
    let requestedKind: string | null = null;
    let released = 0;
    (globalThis as any).navigator = {
      wakeLock: {
        request: async (kind: string) => {
          requestedKind = kind;
          return { release: () => released++ };
        },
      },
    };
    const release = requestScreenWakeLock();
    await tick();
    check('web: requests the screen wake lock', requestedKind === 'screen');
    check('web: does not touch expo-keep-awake', keepAwakeCalls.length === 0);
    release();
    check('web: release() releases the sentinel', released === 1);
  }

  /* ---------- keepAwake: web re-requests on visibility return ---------- */
  {
    reset();
    platformStub.OS = 'web';
    let requests = 0;
    (globalThis as any).navigator = {
      wakeLock: {
        request: async () => {
          requests++;
          return { release: () => {} };
        },
      },
    };
    const listeners: Record<string, () => void> = {};
    (globalThis as any).document = {
      visibilityState: 'hidden',
      addEventListener: (e: string, fn: () => void) => (listeners[e] = fn),
      removeEventListener: (e: string) => delete listeners[e],
    };
    const release = requestScreenWakeLock();
    await tick();
    check('web: initial request made', requests === 1);
    requests = 0;
    // visibilitychange while hidden must NOT re-request.
    listeners['visibilitychange']();
    await tick();
    check('web: hidden tab does not re-request', requests === 0);
    (globalThis as any).document.visibilityState = 'visible';
    listeners['visibilitychange']();
    await tick();
    check('web: visible tab re-requests the lock', requests === 1);
    release();
    check('web: listener removed on release', !('visibilitychange' in listeners));
  }

  /* ---------- keepAwake: web without the API is a silent no-op ---------- */
  {
    reset();
    platformStub.OS = 'web';
    (globalThis as any).navigator = {}; // no wakeLock
    let threw = false;
    try {
      const release = requestScreenWakeLock();
      release();
    } catch {
      threw = true;
    }
    check('web: missing Wake Lock API never throws', !threw);
    check('web: missing API makes no native calls', keepAwakeCalls.length === 0);
  }

  /* ---------- keepAwake: web denial never throws ---------- */
  {
    reset();
    platformStub.OS = 'web';
    (globalThis as any).navigator = {
      wakeLock: { request: async () => { throw new Error('denied'); } },
    };
    let threw = false;
    try {
      const release = requestScreenWakeLock();
      await tick();
      release();
    } catch {
      threw = true;
    }
    check('web: denied request never throws', !threw);
  }

  /* ---------- keepAwake: native path uses expo-keep-awake ---------- */
  {
    reset();
    platformStub.OS = 'ios';
    const release = requestScreenWakeLock();
    await tick();
    const act = keepAwakeCalls.filter((c) => c.fn === 'activate');
    check('native: activateKeepAwakeAsync called once', act.length === 1);
    check('native: activate carries a tag', typeof act[0]?.tag === 'string');
    release();
    await tick();
    const deact = keepAwakeCalls.filter((c) => c.fn === 'deactivate');
    check(
      'native: deactivate called with the same tag',
      deact.length === 1 && deact[0].tag === act[0].tag,
    );
  }

  /* ---------- keepAwake: concurrent locks get independent tags ---------- */
  {
    reset();
    platformStub.OS = 'ios';
    const r1 = requestScreenWakeLock();
    const r2 = requestScreenWakeLock();
    await tick();
    const tags = keepAwakeCalls.filter((c) => c.fn === 'activate').map((c) => c.tag);
    check('native: two requests get distinct tags', tags.length === 2 && tags[0] !== tags[1]);
    r1();
    await tick();
    const deacts = keepAwakeCalls.filter((c) => c.fn === 'deactivate');
    check('native: releasing one only deactivates its tag', deacts.length === 1 && deacts[0].tag === tags[0]);
    r2();
    r2(); // double release is safe
    await tick();
    check(
      'native: both releases deactivate both tags',
      keepAwakeCalls.filter((c) => c.fn === 'deactivate').length === 2,
    );
  }

  /* ---------- keepAwake: native failure never throws ---------- */
  {
    reset();
    platformStub.OS = 'ios';
    keepAwakeStub.activateKeepAwakeAsync = async () => {
      throw new Error('native unavailable');
    };
    let threw = false;
    try {
      const release = requestScreenWakeLock();
      await tick();
      release();
      await tick();
    } catch {
      threw = true;
    }
    check('native: failed activation never throws', !threw);
  }

  /* ---------- tone: web never touches expo-audio ---------- */
  {
    reset();
    platformStub.OS = 'web';
    (globalThis as any).window = {}; // no AudioContext
    let threw = false;
    try {
      playBreathTone();
      playPelvicTone();
    } catch {
      threw = true;
    }
    delete (globalThis as any).window;
    check('web: tones without AudioContext never throw', !threw);
    check('web: tones do not create audio players', madePlayers.length === 0);
  }

  /* ---------- tone: native plays the bundled chimes ---------- */
  {
    reset();
    platformStub.OS = 'ios';
    playBreathTone();
    playPelvicTone();
    await tick();
    await tick();
    check('native: two players created (one per section)', madePlayers.length === 2);
    check(
      'native: breathing plays its own chime asset',
      madePlayers.some((p) => p.asset === BREATH_WAV),
    );
    check(
      'native: pelvic floor plays its own chime asset',
      madePlayers.some((p) => p.asset === PELVIC_WAV),
    );
    check(
      'native: sound design stays distinct (different assets)',
      madePlayers[0].asset !== madePlayers[1].asset,
    );
    check('native: both chimes played', madePlayers.every((p) => p.playCalls >= 1));
    check(
      'native: silent switch is respected (session never bypasses silent mode)',
      audioModeCalls.length > 0 &&
        audioModeCalls.every((m: any) => m && m.playsInSilentMode === false),
    );
  }

  /* ---------- tone: native audio failure never throws ---------- */
  {
    reset();
    platformStub.OS = 'ios';
    audioCreateThrows = true;
    let threw = false;
    try {
      playBreathTone();
      playPelvicTone();
      await tick();
    } catch {
      threw = true;
    }
    check('native: audio failure never throws', !threw);
  }

  if (failures > 0) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
  }
  console.log('all native-gap checks passed');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
