/**
 * Soft tone cue for the breathing pacer (Willow, Sept 2026).
 *
 * Web: WebAudio — a gentle 392 Hz sine with a soft attack/decay envelope,
 * exactly as the design mockup's `softTone()` does. Independent of the haptic
 * pulse — either, both, or neither can be on.
 *
 * Native (iOS/Android): the same 392 Hz / 0.55s envelope pre-rendered as
 * `src/labor/assets/chime-breathing.wav` (see tools/gen_labor_chimes.py) and
 * played through `expo-audio`. Best-effort, never throws.
 */
import { Platform } from 'react-native';
import { playNativeChime } from '../nativeChime';

let ctx: AudioContext | null = null;

function playWebSoftTone(): void {
  try {
    const AC =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : null;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 392;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  } catch {
    /* never break the pacer */
  }
}

export function playSoftTone(): void {
  if (Platform.OS !== 'web') {
    playNativeChime(require('../assets/chime-breathing.wav') as number);
    return;
  }
  playWebSoftTone();
}
