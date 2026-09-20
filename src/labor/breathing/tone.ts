/**
 * Soft tone cue for the breathing pacer (Willow, Sept 2026).
 *
 * WebAudio: a gentle 392 Hz sine with a soft attack/decay envelope, exactly
 * as the design mockup's `softTone()` does. Independent of the haptic
 * pulse — either, both, or neither can be on. On native builds without
 * WebAudio this is a safe no-op (a native tone would need an audio
 * dependency — coordinator call).
 */
let ctx: AudioContext | null = null;

export function playSoftTone(): void {
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
