/**
 * Native soft-chime playback for the labor-readiness sections (Willow, Sept 2026).
 *
 * The web builds synthesize their tones with WebAudio; native builds have no
 * WebAudio, so each section plays a pre-rendered WAV asset through
 * `expo-audio`'s `createAudioPlayer`. The two sections keep their own assets
 * (distinct sound design — do not unify them).
 *
 * Silent-switch behavior (Anuraj's decision, reversed Sept 20 2026 ~14:53
 * PDT — supersedes the ~13:10 "respect the silent switch" decision): the
 * native chimes must PLAY THROUGH the iPhone silent switch. Rationale:
 * the soft tone is session content the user explicitly opted into (the
 * Soft tone toggle ON), not a notification — same as music/meditation
 * apps. Whenever the Soft tone toggle is on and device volume is up, the
 * phase-change chime plays, silent switch or not. expo-audio v57 defaults
 * `playsInSilentMode` to `true`, but the session is configured explicitly
 * with `playsInSilentMode: true` so the intent is locked in code and the
 * guard test in tests/labor-native-gaps.test.ts enforces it.
 *
 * Best-effort only — never throws. Players are created lazily on first use,
 * so merely importing this module never touches native audio.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

const players = new Map<number, AudioPlayer>();
let audioModeSet = false;

function playerFor(asset: number): AudioPlayer | null {
  try {
    let p = players.get(asset);
    if (!p) {
      p = createAudioPlayer(asset);
      players.set(asset, p);
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * Play a bundled chime asset (a Metro `require('…​.wav')` id) from the start.
 * The audio session is configured once with `playsInSilentMode: true` so
 * the phase-change chime plays whenever the Soft tone toggle is on and
 * volume is up — silent switch or not (Anuraj's reversal, Sept 20 2026).
 * Web is untouched — WebAudio chimes play as before.
 */
export function playNativeChime(asset: number): void {
  try {
    if (!audioModeSet) {
      audioModeSet = true;
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
        /* ignore — play through whatever session is active */
      });
    }
    const p = playerFor(asset);
    if (!p) return;
    void (async () => {
      try {
        await p.seekTo(0);
      } catch {
        /* keep going — replay from wherever it is */
      }
      try {
        p.play();
      } catch {
        /* never break the session */
      }
    })();
  } catch {
    /* never break the session */
  }
}
