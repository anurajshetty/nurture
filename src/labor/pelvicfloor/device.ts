/**
 * Pelvic-floor relaxation — device niceties for the guided session.
 *
 * The mockup offers a soft tone at each phase change. The screen wake lock
 * moved to the shared labor module (`src/labor/keepAwake.ts`) — Web Wake
 * Lock API on web, `expo-keep-awake` on native.
 *
 * The tone: web builds synthesize a 523.25 Hz (C5) sine with a gentle
 * attack/decay envelope via WebAudio (code below, unchanged); native builds
 * play the same envelope pre-rendered as
 * `src/labor/assets/chime-pelvicfloor.wav` (see tools/gen_labor_chimes.py)
 * through `expo-audio`. Both are best-effort and never throw.
 */
import { Platform } from 'react-native';
import { playNativeChime } from '../nativeChime';

/* eslint-disable @typescript-eslint/no-explicit-any */

let audioCtx: any = null;

function playWebSoftTone(): void {
  try {
    if (typeof window === 'undefined') return;
    const w = window as any;
    const AC = w.AudioContext || w.webkitAudioContext;
    if (typeof AC !== 'function') return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, t); // C5 — calm, not piercing
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 1.5);
  } catch {
    /* best-effort only */
  }
}

/**
 * One soft chime (sine, gentle attack/decay). The session plays it at each
 * phase change when the "Soft tone" toggle is on.
 */
export function playSoftTone(): void {
  if (Platform.OS !== 'web') {
    playNativeChime(require('../assets/chime-pelvicfloor.wav') as number);
    return;
  }
  playWebSoftTone();
}
