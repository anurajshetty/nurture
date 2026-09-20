/**
 * Labor-readiness section — centralized copy + section config
 * (Willow, Sept 2026; design source of truth: mockups 27/28/29).
 *
 * ALL user-facing medical-ish strings for the labor-readiness section
 * live here, so the final medical-copy pass can swap lines without UI
 * churn. Each string is marked FINAL or PLACEHOLDER.
 *
 * Copy status (Sept 20, 2026 — designer, first pass, not legal counsel):
 * - 5-1-1 note: FINAL, keep as-is.
 * - Provider / pelvic-floor deferral line: FINAL.
 * - Perineal-massage safety lines: PLACEHOLDER until final lines land
 *   (tweaked per APA/NHS; final legal sign-off still recommended before
 *   shipping). The pelvic-floor screen owns that block; the strings are
 *   centralized here for its use.
 *
 * Hard rule (designer): NEVER add pattern-triggered alerts or wording
 * like "you may be in labor" / "time to go to the hospital" without
 * fresh copy and legal review. The 5-1-1 note stays quiet and
 * informational.
 */

/* ------------------------------------------------------------------ */
/* Section config — the one-line knobs Anuraj can adjust.              */
/* ------------------------------------------------------------------ */

/**
 * Week-tab gating (Anuraj's decision, Sept 20, 2026): the "Labor
 * readiness" entry card renders on the Week tab ONLY for displayed
 * weeks at or above this number, through end of pregnancy. It must NOT
 * render earlier. One-line change to adjust.
 */
export const LABOR_READINESS_MIN_WEEK = 35;

/**
 * True when the labor-readiness entry card may appear for the DISPLAYED
 * week number (completed weeks + 1 — the single shared week rule).
 */
export function laborCardVisibleForDisplayedWeek(displayedWeek: number): boolean {
  return (
    Number.isInteger(displayedWeek) && displayedWeek >= LABOR_READINESS_MIN_WEEK
  );
}

/* ------------------------------------------------------------------ */
/* Shared section strings.                                             */
/* ------------------------------------------------------------------ */

/** FINAL. Renders at the bottom of every labor-readiness screen. */
export const LABOR_DISCLAIMER =
  "This isn't medical advice — your care team knows your situation best.";

/**
 * FINAL (Sept 20, 2026). The provider/pelvic-floor deferral line — placed
 * per the pelvic-floor mockup (screen 29), centralized here for swap-in.
 */
export const PROVIDER_DEFERRAL_LINE =
  "Questions about what's right for you belong with your provider or a pelvic-floor physical therapist.";

/* ------------------------------------------------------------------ */
/* Contraction timer (mockup 27).                                      */
/* ------------------------------------------------------------------ */

export const TIMER_COPY = {
  /** Screen kicker. */
  kicker: 'Labor readiness',
  title: 'Contraction timer',
  /** Idle lede. */
  idleLede:
    "One tap when a contraction starts — we'll time it and keep your history.",
  /** Big start circle. */
  startTitle: 'Start timing',
  startSub: 'tap when it begins',
  /** Timing screen. */
  timingLabel: 'Contraction in progress',
  stopTitle: 'Stop timing',
  sinceLast: 'Since last',
  lastLength: 'Last length',
  awakeNoteIdle: 'Screen stays awake while timing · works offline',
  awakeNoteTiming: 'Your screen stays awake while you time',
  timingHint: 'Big button, no thinking — hand it to your partner if you like.',
  /** Logged ("paused") screen. */
  loggedTitle: 'Contraction logged',
  savedLine: 'Saved to your history.',
  nextButton: 'Time the next one',
  historyButton: "View tonight's history",
  /** History screen. */
  historyKicker: 'Last 6 hours',
  historyTitle: "Tonight's history",
  historyHint: 'Tap any entry to fix a mistap — nothing here is permanent.',
  /** 5-1-1 badge — FINAL, quiet and informational only. */
  fiveOneOneLead: 'A quiet note:',
  fiveOneOneBody: 'many providers mention 5-1-1 — yours comes first.',
  /** Edit sheet. */
  editSub: 'Fix a mistap — adjust or remove this entry.',
  lengthLabel: 'Length',
  startedAtLabel: 'Started at',
  done: 'Done',
  deleteEntry: 'Delete this entry',
  deleteTitle: 'Delete this entry?',
  keepIt: 'Keep it',
  delete: 'Delete',
} as const;

/* ------------------------------------------------------------------ */
/* Week-tab entry card (mockup 27 "Week tab entry").                   */
/* ------------------------------------------------------------------ */

export const WEEK_CARD_COPY = {
  pill: 'For labor day',
  kicker: 'Getting ready',
  title: 'Labor readiness',
  body: 'Contraction timer, breathing practice, and relaxation — everything for the big day, one tap away.',
} as const;

/* ------------------------------------------------------------------ */
/* Labor hub (app/labor.tsx).                                          */
/* ------------------------------------------------------------------ */

export const HUB_COPY = {
  kicker: 'Labor readiness',
  title: 'Getting ready for the big day',
  lede: 'Three calm companions for labor day — a timer, breathing, and relaxation. Start anything in a tap or two.',
  timerTitle: 'Contraction timer',
  timerBody: 'One tap to time each contraction, with a quiet history.',
  breathingTitle: 'Breathing practice',
  breathingBody: 'Slow, guided breathing for labor day — and for right now.',
  pelvicFloorTitle: 'Pelvic floor relaxation',
  pelvicFloorBody: 'Gentle release practice for the weeks ahead.',
} as const;
