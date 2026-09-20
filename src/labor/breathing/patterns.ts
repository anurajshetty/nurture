/**
 * Lamaze breathing pacer — pure pattern/timing logic (Willow, Sept 2026).
 *
 * Faithful to design mockup 28 (labor-readiness breathing). This module is
 * deliberately UI-free so the sequencing, timing, and start/stop state
 * machine are unit-testable without React Native (see
 * tests/labor-breathing.test.ts).
 *
 * ---- Medical copy ----
 * The copy constants below are the FINAL approved lines (designer,
 * Sept 20 2026): the breathing intro is KEEP-as-is from the mockup, and the
 * disclaimer is the exact required line. HARD RULE (designer/legal):
 * NEVER add pattern-triggered alert copy — e.g. "you may be in labor" or
 * "time to go to the hospital" — without fresh copy and legal review.
 * The pacer must not gain any new alert copy.
 */

/** Final approved copy (designer KEEP, Sept 20 2026). */
export const BREATHING_INTRO_COPY =
  'Breathing patterns many parents practice for labor. There\u2019s no single right way to breathe \u2014 practice now and notice what feels best.';

/** Final approved copy (designer-verified, Sept 20 2026). Must render in this section. */
export const MEDICAL_DISCLAIMER =
  'This isn\u2019t medical advice \u2014 your care team knows your situation best.';

export const PRACTICE_NOTE_LEAD = 'During practice';
export const PRACTICE_NOTE_BODY =
  ' you can switch on eyes-closed mode, a haptic pulse, or a soft tone at each phase change \u2014 made for following along without looking.';

/** Banned alert phrases: must never appear in this section's copy (hard rule). */
export const BANNED_ALERT_PHRASES = [
  'you may be in labor',
  'time to go to the hospital',
] as const;

export type BreathKind = 'in' | 'out' | 'hold';

export type PatternId = 'cleanse' | 'slow' | 'light' | 'patterned';

export type LoopPhase = {
  label: string;
  /** seconds */
  s: number;
  kind: BreathKind;
};

export type BreathingPattern = {
  id: PatternId;
  name: string;
  tag: string;
  desc: string;
  loop: LoopPhase[];
  /** standalone practice (no cleansing wrap): repeat loop this many times */
  reps?: number;
  /** wrapped practice: opening + closing cleansing breaths around loop reps */
  wrap?: boolean;
};

export const PATTERN_ORDER: PatternId[] = ['cleanse', 'slow', 'light', 'patterned'];

export const PATTERNS: Record<PatternId, BreathingPattern> = {
  cleanse: {
    id: 'cleanse',
    name: 'Cleansing breath',
    tag: 'The reset breath',
    desc: 'In through your nose, a slow sigh out. Every round opens and closes with one.',
    loop: [
      { label: 'breathe in\u2026', s: 4, kind: 'in' },
      { label: 'breathe out\u2026', s: 6, kind: 'out' },
    ],
    reps: 6,
    wrap: false,
  },
  slow: {
    id: 'slow',
    name: 'Slow-paced breathing',
    tag: 'Steady and unhurried',
    desc: 'About half your normal pace \u2014 in 4, out 6. Settle in and let it carry you.',
    loop: [
      { label: 'breathe in\u2026', s: 4, kind: 'in' },
      { label: 'breathe out\u2026', s: 6, kind: 'out' },
    ],
    wrap: true,
  },
  light: {
    id: 'light',
    name: 'Light breathing',
    tag: 'Light and easy',
    desc: 'Light, a little quicker, in and out through your mouth. Easy does it.',
    loop: [
      { label: 'breathe in\u2026', s: 2, kind: 'in' },
      { label: 'breathe out\u2026', s: 2, kind: 'out' },
    ],
    wrap: true,
  },
  patterned: {
    id: 'patterned',
    name: 'Patterned breathing',
    tag: 'Hee, hee, hoo',
    desc: 'Two quick breaths, one longer sigh \u2014 a classic for a reason.',
    loop: [
      { label: 'hee\u2026', s: 1, kind: 'in' },
      { label: 'hee\u2026', s: 1, kind: 'out' },
      { label: 'hoo\u2026', s: 3, kind: 'out' },
      { label: 'rest\u2026', s: 1, kind: 'hold' },
    ],
    wrap: true,
  },
};

export type SeqPhase = LoopPhase & {
  /** which part of the round this phase belongs to (drives the small tag line) */
  tag: string;
};

const OPENING_TAG = 'Opening cleansing breath';
const CLOSING_TAG = 'Closing cleansing breath';

/**
 * Build the full timed phase sequence for a pattern.
 * Rounds run ~1 minute: opening cleansing breath (10s) + pattern (~40s) +
 * closing cleansing breath (10s). `speedScale` divides every phase length
 * (1 = real time; >1 speeds the pacer, e.g. for tests).
 */
export function buildSeq(pid: PatternId, speedScale = 1): SeqPhase[] {
  const p = PATTERNS[pid];
  const scale = speedScale > 0 ? speedScale : 1;
  const seq: SeqPhase[] = [];
  const push = (ph: LoopPhase, tag: string) =>
    seq.push({ label: ph.label, s: ph.s / scale, kind: ph.kind, tag });

  if (p.wrap) {
    push({ label: 'breathe in\u2026', s: 4, kind: 'in' }, OPENING_TAG);
    push({ label: 'breathe out\u2026', s: 6, kind: 'out' }, OPENING_TAG);
    const loopT = p.loop.reduce((a, x) => a + x.s, 0);
    const n = Math.max(1, Math.round(40 / loopT));
    for (let i = 0; i < n; i++) p.loop.forEach((ph) => push(ph, p.name));
    push({ label: 'breathe in\u2026', s: 4, kind: 'in' }, CLOSING_TAG);
    push({ label: 'breathe out\u2026', s: 6, kind: 'out' }, CLOSING_TAG);
  } else {
    const reps = p.reps ?? 1;
    for (let i = 0; i < reps; i++) p.loop.forEach((ph) => push(ph, p.name));
  }
  return seq;
}

/** Total round length in milliseconds. */
export function roundDurationMs(seq: SeqPhase[]): number {
  return seq.reduce((a, p) => a + p.s * 1000, 0);
}

export type PhaseCursor = {
  /** index into seq, or seq.length when the round is finished */
  index: number;
  phase: SeqPhase | null;
  /** ms elapsed inside the current phase */
  phaseElapsedMs: number;
  done: boolean;
};

/**
 * Locate the phase active at `elapsedMs` into the round. Drift-resistant:
 * computed from absolute elapsed time, never from accumulated ticks.
 */
export function phaseAtElapsed(seq: SeqPhase[], elapsedMs: number): PhaseCursor {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    const dur = seq[i].s * 1000;
    if (acc + dur > elapsedMs) {
      return { index: i, phase: seq[i], phaseElapsedMs: elapsedMs - acc, done: false };
    }
    acc += dur;
  }
  return { index: seq.length, phase: null, phaseElapsedMs: 0, done: true };
}

/** '0:42 left' — matches the mockup's time-left label. */
export function formatTimeLeft(totalMsLeft: number): string {
  const s = Math.max(0, Math.ceil(totalMsLeft / 1000));
  return `0:${s < 10 ? '0' : ''}${s} left`;
}

export type TickView = {
  done: boolean;
  phaseIndex: number;
  label: string;
  kind: BreathKind;
  tag: string;
  /** whole seconds left in the phase, min 1 */
  phaseSecondsLeft: number;
  totalMsLeft: number;
  totalLeftLabel: string;
  /** 0..1 */
  progress: number;
};

/** Everything the pacer UI needs for one 200ms tick. */
export function tickView(seq: SeqPhase[], startedAtMs: number, nowMs: number): TickView {
  const total = roundDurationMs(seq);
  const elapsed = Math.max(0, nowMs - startedAtMs);
  if (elapsed >= total) {
    return {
      done: true,
      phaseIndex: seq.length,
      label: '',
      kind: 'out',
      tag: '',
      phaseSecondsLeft: 0,
      totalMsLeft: 0,
      totalLeftLabel: formatTimeLeft(0),
      progress: 1,
    };
  }
  const cursor = phaseAtElapsed(seq, elapsed);
  const phase = cursor.phase as SeqPhase;
  const phaseLeftMs = phase.s * 1000 - cursor.phaseElapsedMs;
  return {
    done: false,
    phaseIndex: cursor.index,
    label: phase.label,
    kind: phase.kind,
    tag: phase.tag,
    phaseSecondsLeft: Math.max(1, Math.ceil(phaseLeftMs / 1000)),
    totalMsLeft: total - elapsed,
    totalLeftLabel: formatTimeLeft(total - elapsed),
    progress: Math.min(1, elapsed / total),
  };
}

/* ------------------------------------------------------------------ */
/* Pacer state machine: idle (pattern list) → running (pacer) → done   */
/* (round complete). 'end' is the gentle stop: it always returns to    */
/* the pattern list, never to a half-state.                            */
/* ------------------------------------------------------------------ */

export type PacerMachine =
  | { phase: 'idle' }
  | { phase: 'running'; patternId: PatternId; seq: SeqPhase[]; startedAtMs: number }
  | { phase: 'done'; patternId: PatternId };

export type PacerAction =
  | { type: 'start'; patternId: PatternId; nowMs: number }
  | { type: 'tick'; nowMs: number }
  | { type: 'end' };

export function pacerReducer(state: PacerMachine, action: PacerAction): PacerMachine {
  switch (action.type) {
    case 'start': {
      const seq = buildSeq(action.patternId);
      return { phase: 'running', patternId: action.patternId, seq, startedAtMs: action.nowMs };
    }
    case 'tick': {
      if (state.phase !== 'running') return state;
      const total = roundDurationMs(state.seq);
      if (action.nowMs - state.startedAtMs >= total) {
        return { phase: 'done', patternId: state.patternId };
      }
      return state;
    }
    case 'end':
      return { phase: 'idle' };
  }
}
