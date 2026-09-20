/**
 * Native soft-chime playback for the labor-readiness sections (Willow, Sept 2026).
 *
 * The web builds synthesize their tones with WebAudio; native builds have no
 * WebAudio, so each section plays a pre-rendered WAV asset through
 * `expo-audio`'s `createAudioPlayer`. The two sections keep their own assets
 * (distinct sound design — do not unify them).
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
 * The audio session is configured once so the gentle cue still sounds when
 * the phone's silent switch is on, matching the web behavior.
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
