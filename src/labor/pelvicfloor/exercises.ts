/**
 * Pelvic-floor relaxation — exercise configs + guided-session state machine
 * (mockup 29, Sept 2026).
 *
 * Pure logic only: no React Native, no timers, no network. The screen
 * (`app/labor/pelvicfloor.tsx`) advances this machine once per second.
 * Fully covered by tests/labor-pelvicfloor.test.ts.
 *
 * HARD RULE (Anuraj, Sept 20, 2026): NEVER add pattern-triggered alerts or
 * wording like "you may be in labor" / "time to go to the hospital" here or
 * anywhere in this section without fresh copy and legal review.
 */

export type ExerciseId = 'breath' | 'reverse' | 'visual' | 'positions';

export interface ExercisePhase {
  /** On-screen phase cue, e.g. "breathe in…" */
  label: string;
  /** Gentle guidance line shown under the cue. */
  sub: string;
  /** Phase length in whole seconds. */
  secs: number;
  /** Pacer grows during the phase (true) or shrinks (false). */
  grow: boolean;
}

export interface ExerciseConfig {
  id: ExerciseId;
  title: string;
  /** Card description on the guide overview. */
  description: string;
  /** Time chip on the guide card, e.g. "~1 min" or "guide". */
  timeChip: string;
  /** Tile tint + icon stroke colors (from the mockup). */
  tileBg: string;
  tileStroke: string;
  phases: ExercisePhase[];
  rounds: number;
}

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  breath: {
    id: 'breath',
    title: 'Connection breath',
    description:
      'Link your breath to your pelvic floor — inhale to widen, exhale to release.',
    timeChip: '~1 min',
    tileBg: '#EAF1E8',
    tileStroke: '#6F8F6E',
    phases: [
      {
        label: 'breathe in…',
        sub: 'Feel your ribcage widen and your pelvic floor gently open.',
        secs: 4,
        grow: true,
      },
      {
        label: 'let it go…',
        sub: 'Soften everything down — belly, hips, pelvic floor.',
        secs: 6,
        grow: false,
      },
    ],
    rounds: 4,
  },
  reverse: {
    id: 'reverse',
    title: 'Reverse Kegel · "letting go"',
    description:
      'The opposite of a squeeze — practice the gentle bulge and release of birth.',
    timeChip: '~1 min',
    tileBg: '#F6E7DD',
    tileStroke: '#C85F3E',
    phases: [
      {
        label: 'settle in…',
        sub: 'Take a slow breath in and soften your belly.',
        secs: 4,
        grow: true,
      },
      {
        label: 'gently release…',
        sub: 'A soft, gentle push downward — like letting go, never a squeeze.',
        secs: 6,
        grow: false,
      },
    ],
    rounds: 4,
  },
  visual: {
    id: 'visual',
    title: 'Visualizations',
    description:
      'A flower opening, a tide going out — images that teach your body to soften.',
    timeChip: '~1 min',
    tileBg: '#EAF1E8',
    tileStroke: '#6F8F6E',
    phases: [
      {
        label: 'picture it…',
        sub: 'Imagine a flower slowly opening, petal by petal.',
        secs: 4,
        grow: true,
      },
      {
        label: 'let it open…',
        sub: 'With each breath out, the flower opens a little wider.',
        secs: 6,
        grow: false,
      },
    ],
    rounds: 4,
  },
  positions: {
    id: 'positions',
    title: 'Release positions',
    description:
      'Comfortable postures that let your pelvis open and your floor relax.',
    timeChip: 'guide',
    tileBg: '#F6E7DD',
    tileStroke: '#C85F3E',
    phases: [
      {
        label: 'settle…',
        sub: 'Hands and knees, side-lying, or a supported squat — whatever feels restful.',
        secs: 4,
        grow: true,
      },
      {
        label: 'soften…',
        sub: 'Let your belly hang heavy and your pelvis open. No effort, just gravity.',
        secs: 6,
        grow: false,
      },
    ],
    rounds: 4,
  },
};

export const EXERCISE_ORDER: ExerciseId[] = ['breath', 'reverse', 'visual', 'positions'];

/** Immutable snapshot of a guided session. `round` is 1-based. */
export interface SessionState {
  config: ExerciseConfig;
  round: number;
  phaseIndex: number;
  /** Whole seconds remaining in the current phase. */
  remaining: number;
  status: 'running' | 'done';
}

/** Begin a fresh session for an exercise. */
export function startSession(id: ExerciseId): SessionState {
  const config = EXERCISES[id];
  return {
    config,
    round: 1,
    phaseIndex: 0,
    remaining: config.phases[0].secs,
    status: 'running',
  };
}

/** The phase the session is currently in (last phase once done). */
export function currentPhase(s: SessionState): ExercisePhase {
  return s.config.phases[Math.min(s.phaseIndex, s.config.phases.length - 1)];
}

/**
 * Advance the session by one second. Pure: returns a new state, never
 * mutates. At the final second of the final round the status flips to
 * 'done' (the screen then shows the "well done" state).
 */
export function tickSession(s: SessionState): SessionState {
  if (s.status === 'done') return s;
  if (s.remaining > 1) {
    return { ...s, remaining: s.remaining - 1 };
  }
  const { config, round, phaseIndex } = s;
  if (phaseIndex < config.phases.length - 1) {
    return {
      ...s,
      phaseIndex: phaseIndex + 1,
      remaining: config.phases[phaseIndex + 1].secs,
    };
  }
  if (round < config.rounds) {
    return {
      ...s,
      round: round + 1,
      phaseIndex: 0,
      remaining: config.phases[0].secs,
    };
  }
  return { ...s, status: 'done', remaining: 0 };
}

/** Restart = fresh session of the same exercise. */
export function restartSession(s: SessionState): SessionState {
  return startSession(s.config.id);
}

export type DotState = 'done' | 'now' | 'todo';

/**
 * Progress dots: rounds before the current are 'done', the current round is
 * 'now', later rounds are 'todo'. All 'done' once the session completes.
 */
export function dotStates(s: SessionState): DotState[] {
  const out: DotState[] = [];
  for (let i = 1; i <= s.config.rounds; i++) {
    if (s.status === 'done' || i < s.round) out.push('done');
    else if (i === s.round) out.push('now');
    else out.push('todo');
  }
  return out;
}

/** Total guided seconds for an exercise (all rounds). */
export function totalSessionSecs(config: ExerciseConfig): number {
  return config.rounds * config.phases.reduce((sum, p) => sum + p.secs, 0);
}
