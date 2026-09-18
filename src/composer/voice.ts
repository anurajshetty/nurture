/**
 * Dictation for the composer (Epic 2.1).
 *
 * One code path for iOS and web: `expo-speech-recognition` wraps Apple's
 * Speech framework on iOS and the Web Speech API on web. The transcript
 * always lands in the composer field for her review BEFORE sending —
 * dictation never submits on its own.
 *
 * Privacy: `requiresOnDeviceRecognition` asks the OS to keep audio
 * on-device when the device supports it. Nothing here calls a cloud
 * speech API directly.
 *
 * QA rule: never drive live voice in automated tests — the mic flow is
 * verified by hand only.
 */

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { EventSubscription } from 'expo-modules-core';

export interface VoiceCallbacks {
  /** Interim (partial) transcript while she speaks. */
  onInterim: (text: string) => void;
  /** Final transcript after stop(). */
  onFinal: (text: string) => void;
  /** Listening ended on its own (auto-stop) without a fresh final result. */
  onStopped: () => void;
  /** Kind, plain-language failure — the UI offers typing instead. */
  onError: (message: string) => void;
}

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
    default:
      return 'Dictation hit a snag — typing works just as well.';
  }
}

/**
 * Starts one dictation session. Resolves true when listening actually
 * began; false when permission was denied or recognition is unavailable
 * (the caller should fall back to the keyboard silently).
 */
export async function startDictation(cb: VoiceCallbacks): Promise<{
  stop: () => void;
  abort: () => void;
} | null> {
  let permission;
  try {
    permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  } catch {
    cb.onError(kindErrorMessage('not-allowed'));
    return null;
  }
  if (!permission.granted) {
    cb.onError(kindErrorMessage('not-allowed'));
    return null;
  }

  const subs: EventSubscription[] = [];
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        // Listener teardown is best-effort.
      }
    }
  };

  subs.push(
    ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const text = event.results?.[0]?.transcript?.trim() ?? '';
      if (!text) return;
      if (event.isFinal) {
        cb.onFinal(text);
      } else {
        cb.onInterim(text);
      }
    }),
  );
  subs.push(
    ExpoSpeechRecognitionModule.addListener('error', (event) => {
      cleanup();
      // 'aborted' is our own teardown (unmount) — stay silent.
      if (event.error === 'aborted') return;
      cb.onError(kindErrorMessage(event.error));
    }),
  );
  subs.push(
    ExpoSpeechRecognitionModule.addListener('end', () => {
      cleanup();
      cb.onStopped();
    }),
  );

  try {
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      // Keep audio on-device where the OS supports it.
      requiresOnDeviceRecognition: true,
    });
  } catch {
    cleanup();
    cb.onError(kindErrorMessage(undefined));
    return null;
  }

  return {
    stop: () => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // stop() after an error is a no-op; the error listener fired already.
      }
      // Final transcript arrives via the 'result' event; give the OS a
      // beat, then release listeners either way.
      setTimeout(cleanup, 1500);
    },
    abort: () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Best-effort.
      }
      cleanup();
    },
  };
}
