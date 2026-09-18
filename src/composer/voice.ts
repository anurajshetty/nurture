/**
 * Continuous dictation for the composer (Epic 2.4).
 *
 * One code path for iOS and web: `expo-speech-recognition` wraps Apple's
 * Speech framework on iOS and the Web Speech API on web. The transcript
 * always lands in the composer field for her review BEFORE sending —
 * dictation never submits on its own.
 *
 * Why chaining: neither platform offers an indefinite single session.
 * - iOS: Apple expects audio sessions of "about one minute" (Speech
 *   framework guidance; SFSpeechAudioBufferRecognitionRequest stops
 *   accepting audio past ~60s). Chaining a fresh request when the OS ends
 *   one is the standard, documented-tolerated pattern — Apple does not
 *   prohibit it. The module's `continuous: true` option disables its own
 *   3-second silence timer (verified in the v57 native source), so the
 *   session only ends on the OS limit, an error, or user stop.
 * - Web (Chrome): the Web Speech API fires `onend` on its own (silence,
 *   session limits); restart-on-end is the standard pattern. `continuous`
 *   is passed straight through to the browser recognizer.
 *
 * Seam honesty: when the OS ends a session, audio spoken during the
 * teardown/restart window (a few hundred ms) is captured by NEITHER
 * session and can be lost. We minimize it by restarting immediately with
 * no artificial delay beyond what the native module needs, commit the
 * in-progress interim tail at the seam (nothing already transcribed is
 * lost), and de-duplicate repeated words across the boundary.
 *
 * Privacy: `requiresOnDeviceRecognition` asks the OS to keep audio
 * on-device when the device supports it. Nothing here calls a cloud
 * speech API directly, saves audio, or sends voice anywhere.
 *
 * QA rule: never drive live voice in automated tests — the mic flow is
 * verified by hand only. Tests inject a fake module via `deps`.
 */

import type { ExpoSpeechRecognitionModule as ExpoSpeechRecognitionModuleType } from 'expo-speech-recognition';
import type { EventSubscription } from 'expo-modules-core';

type SpeechModule = typeof ExpoSpeechRecognitionModuleType;

export interface VoiceCallbacks {
  /** Full display text (committed finals + in-progress tail) while speaking. */
  onInterim: (text: string) => void;
  /** Dictation finished (user stop / cap): the complete transcript. */
  onFinal: (text: string) => void;
  /** Dictation finished because of a failure — kind message for the UI. */
  onError: (message: string) => void;
  /** The safety cap fired (after onFinal): kind message for the UI. */
  onLimitReached: (message: string) => void;
}

/** Test seam: inject a fake speech module and/or a short cap. */
export interface VoiceDeps {
  module?: SpeechModule;
  /** Safety cap in ms. Default 10 minutes. */
  capMs?: number;
  /** Delay before restarting after an OS-initiated end. Default 350ms. */
  restartDelayMs?: number;
}

/** Generous safety cap: 10 minutes of continuous dictation. */
export const DICTATION_CAP_MS = 10 * 60 * 1000;

const RESTART_DELAY_MS = 350;
const BUSY_RETRY_BASE_MS = 800;
const MAX_BUSY_RETRIES = 3;
/** Consecutive sessions ending with zero results before we give up kindly. */
const MAX_EMPTY_SESSIONS = 3;
/** Grace period for the OS to deliver end/final after user stop. */
const STOP_GRACE_MS = 2500;

const CAP_MESSAGE =
  'I stopped listening after 10 minutes — your words are all in the box above. Tap save when you’re ready.';

function kindErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone access is off — you can type instead, or enable it in Settings.';
    case 'no-speech':
    case 'speech-timeout':
      return 'Didn’t catch that — try again or type it instead.';
    case 'network':
      return 'Dictation needs a connection right now — typing works offline.';
    case 'language-not-supported':
      return 'Dictation isn’t available in this language on this device yet.';
    case 'interrupted':
      return 'Paused — a call or alert interrupted listening. Your words are safe; tap the mic to keep going.';
    case 'service-not-allowed':
      return 'Dictation isn’t available on this device right now — typing works just as well.';
    default:
      return 'Dictation hit a snag — typing works just as well.';
  }
}

/**
 * Joins a newly-finalized chunk onto the committed transcript.
 * Trims word overlap at the boundary (the OS often repeats the last few
 * words of the previous session at the start of the next one) and keeps
 * exactly one space between chunks.
 */
export function stitchTranscript(base: string, addition: string): string {
  const a = base.trimEnd();
  const b = addition.trim().replace(/\s+/g, ' ');
  if (!a) return b;
  if (!b) return a;
  const bWords = b.split(' ');
  const maxK = Math.min(8, bWords.length, a.split(' ').length);
  for (let k = maxK; k >= 1; k -= 1) {
    const prefix = bWords.slice(0, k).join(' ');
    if (a.endsWith(prefix)) {
      const rest = bWords.slice(k).join(' ');
      return rest ? `${a} ${rest}` : a;
    }
  }
  return `${a} ${b}`;
}

type ManagerState =
  | 'starting'
  | 'active'
  | 'restarting'
  | 'user-stopping'
  | 'capping'
  | 'done';

const START_OPTIONS = {
  lang: 'en-US',
  interimResults: true,
  // Native (iOS): disables the module's own 3s silence timer — the session
  // then ends only on the OS request limit, an error, or user stop.
  // Web: passed straight to the browser recognizer.
  continuous: true,
  // Keep audio on-device where the OS supports it.
  requiresOnDeviceRecognition: true,
} as const;

/**
 * Starts continuous dictation. Resolves with stop/abort handles when
 * listening actually began; null when permission was denied or
 * recognition is unavailable (the caller should fall back to the
 * keyboard silently).
 *
 * Lifecycle: sessions chain automatically while she keeps talking.
 * Dictation ends ONLY on user stop(), an error, the 10-minute cap,
 * or abort() (unmount). Interim results update the live tail; final
 * results are committed and never lost at a seam.
 */
export async function startDictation(
  cb: VoiceCallbacks,
  deps?: VoiceDeps,
): Promise<{
  stop: () => void;
  abort: () => void;
} | null> {
  // Lazy-load the real module so this file stays importable in plain-node
  // tests (which inject a fake via deps) — the app only pays for the
  // native module on first mic tap.
  const mod: SpeechModule =
    deps?.module ??
    (await import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
  const capMs = deps?.capMs ?? DICTATION_CAP_MS;
  const restartDelayMs = deps?.restartDelayMs ?? RESTART_DELAY_MS;

  let permission;
  try {
    permission = await mod.requestPermissionsAsync();
  } catch {
    cb.onError(kindErrorMessage('not-allowed'));
    return null;
  }
  if (!permission.granted) {
    cb.onError(kindErrorMessage('not-allowed'));
    return null;
  }

  const subs: EventSubscription[] = [];
  let state: ManagerState = 'starting';
  let committed = '';
  let interimTail = '';
  let sessionActive = false;
  let hadResultsThisSession = false;
  let emptySessions = 0;
  let busyRetries = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let stopGraceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (restartTimer) clearTimeout(restartTimer);
    if (capTimer) clearTimeout(capTimer);
    if (stopGraceTimer) clearTimeout(stopGraceTimer);
    restartTimer = capTimer = stopGraceTimer = null;
  };

  const cleanup = () => {
    clearTimers();
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        // Listener teardown is best-effort.
      }
    }
    subs.length = 0;
  };

  const display = () => stitchTranscript(committed, interimTail);

  /** Fold the in-progress tail into the committed transcript. */
  const foldTail = () => {
    if (interimTail.trim()) {
      committed = stitchTranscript(committed, interimTail);
      interimTail = '';
    }
  };

  const finish = (finalText: string) => {
    if (state === 'done') return;
    state = 'done';
    sessionActive = false;
    cleanup();
    cb.onFinal(finalText.trim());
  };

  const fail = (code: string | undefined) => {
    if (state === 'done') return;
    state = 'done';
    sessionActive = false;
    cleanup();
    cb.onError(kindErrorMessage(code));
  };

  const beginSession = () => {
    if (state === 'done' || state === 'user-stopping' || state === 'capping') return;
    state = 'active';
    hadResultsThisSession = false;
    busyRetries = 0;
    try {
      mod.start({ ...START_OPTIONS });
      sessionActive = true;
    } catch {
      // The module can throw synchronously (e.g. web start() while the
      // previous recognition is still tearing down). One retry, then
      // give up kindly with everything captured so far.
      restartTimer = setTimeout(() => {
        if (state !== 'active' && state !== 'restarting') return;
        try {
          mod.start({ ...START_OPTIONS });
          sessionActive = true;
          state = 'active';
        } catch {
          foldTail();
          fail(undefined);
        }
      }, BUSY_RETRY_BASE_MS);
      state = 'restarting';
    }
  };

  const scheduleRestart = () => {
    if (state === 'done' || state === 'user-stopping' || state === 'capping') return;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    // Don't restart into a backgrounded web tab — recognition can't
    // capture audio there; finish gracefully instead.
    if (typeof document !== 'undefined' && document.hidden) {
      foldTail();
      finish(committed);
      return;
    }
    state = 'restarting';
    restartTimer = setTimeout(() => {
      restartTimer = null;
      beginSession();
    }, restartDelayMs);
  };

  const onCap = () => {
    if (state === 'done') return;
    // Graceful stop: ask the OS for its final result, then finish.
    state = 'capping';
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    foldTail();
    if (sessionActive) {
      try {
        mod.stop();
      } catch {
        // Best-effort; the grace timer finishes us regardless.
      }
      stopGraceTimer = setTimeout(() => finishCap(), STOP_GRACE_MS);
    } else {
      finishCap();
    }
  };

  const finishCap = () => {
    if (state === 'done') return;
    foldTail();
    state = 'done';
    sessionActive = false;
    cleanup();
    const text = committed.trim();
    cb.onFinal(text);
    cb.onLimitReached(CAP_MESSAGE);
  };

  subs.push(
    mod.addListener('result', (event) => {
      if (state === 'done' || state === 'user-stopping' || state === 'capping') return;
      const text = event.results?.[0]?.transcript?.trim() ?? '';
      if (!text) return;
      hadResultsThisSession = true;
      if (event.isFinal) {
        // A finalized chunk (web emits these per utterance in continuous
        // mode; iOS on stop). Commit it and keep listening.
        committed = stitchTranscript(committed, text);
        interimTail = '';
        cb.onInterim(committed);
      } else {
        interimTail = text;
        cb.onInterim(display());
      }
    }),
  );
  subs.push(
    mod.addListener('error', (event) => {
      if (state === 'done' || state === 'user-stopping' || state === 'capping') return;
      // 'aborted' is our own teardown — stay silent.
      if (event.error === 'aborted') return;
      sessionActive = false;
      if (event.error === 'busy') {
        // The recognizer wasn't ready for the chained start (rapid
        // restart race). Back off and retry; don't surface to her.
        busyRetries += 1;
        if (busyRetries <= MAX_BUSY_RETRIES) {
          if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
          }
          state = 'restarting';
          restartTimer = setTimeout(() => {
            restartTimer = null;
            beginSession();
          }, BUSY_RETRY_BASE_MS * busyRetries);
          return;
        }
      }
      if (event.error === 'no-speech' || event.error === 'speech-timeout') {
        // Silence ended the session. Treat like an OS-initiated end:
        // restart within budget so a thinking pause doesn't kill a long
        // entry; give up kindly after repeated empty sessions.
        foldTail();
        if (!hadResultsThisSession) {
          emptySessions += 1;
          if (emptySessions >= MAX_EMPTY_SESSIONS) {
            fail('no-speech');
            return;
          }
        } else {
          emptySessions = 0;
        }
        scheduleRestart();
        return;
      }
      foldTail();
      fail(event.error);
    }),
  );
  subs.push(
    mod.addListener('end', () => {
      sessionActive = false;
      if (state === 'done') return;
      if (state === 'user-stopping' || state === 'capping') {
        if (state === 'user-stopping') {
          foldTail();
          finish(committed);
        } else {
          finishCap();
        }
        return;
      }
      // OS-initiated end (request limit, silence endpointer): commit the
      // tail and chain a fresh session immediately.
      foldTail();
      if (!hadResultsThisSession) {
        emptySessions += 1;
        if (emptySessions >= MAX_EMPTY_SESSIONS) {
          fail('no-speech');
          return;
        }
      } else {
        emptySessions = 0;
      }
      scheduleRestart();
    }),
  );

  capTimer = setTimeout(onCap, capMs);
  beginSession();

  return {
    stop: () => {
      if (state === 'done' || state === 'user-stopping') return;
      state = 'user-stopping';
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (capTimer) {
        clearTimeout(capTimer);
        capTimer = null;
      }
      foldTail();
      if (sessionActive) {
        try {
          mod.stop();
        } catch {
          // stop() after an error is a no-op; the error path fired already.
        }
        // The OS should deliver end/final shortly; finish regardless.
        stopGraceTimer = setTimeout(() => {
          foldTail();
          finish(committed);
        }, STOP_GRACE_MS);
      } else {
        finish(committed);
      }
    },
    abort: () => {
      if (state === 'done') return;
      state = 'done';
      clearTimers();
      if (sessionActive) {
        try {
          mod.abort();
        } catch {
          // Best-effort.
        }
      }
      sessionActive = false;
      cleanup();
    },
  };
}
