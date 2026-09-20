/**
 * Pelvic-floor relaxation — device niceties for the guided session.
 *
 * The mockup calls for the screen to stay awake while she practices
 * ("Screen stays awake while you practice. Nothing to tap unless you
 * want to.") and offers a soft tone at each phase change.
 *
 * No new native dependencies: the wake lock uses the web Wake Lock API
 * where available (no-op elsewhere), and the tone is a short WebAudio
 * sine chime (no-op on native). Both are best-effort and never throw.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let heldLock: { release?: () => void } | null = null;

/** Best-effort screen wake lock. Call on guided-session start. */
export async function keepScreenAwake(): Promise<void> {
  try {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as any;
    if (typeof nav.wakeLock?.request !== 'function') return;
    heldLock = await nav.wakeLock.request('screen');
  } catch {
    heldLock = null;
  }
}

/** Release the wake lock. Safe to call when none is held. */
export function releaseScreenAwake(): void {
  try {
    heldLock?.release?.();
  } catch {
    /* ignore */
  }
  heldLock = null;
}

let audioCtx: any = null;

/**
 * One soft chime (sine, gentle attack/decay). The session plays it at each
 * phase change when the "Soft tone" toggle is on. Web only — silent no-op
 * on native, where the toggle simply has no audible effect.
 */
export function playSoftTone(): void {
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
