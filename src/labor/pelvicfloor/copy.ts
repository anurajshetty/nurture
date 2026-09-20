/**
 * Pelvic-floor relaxation — final medical copy (mockup 29).
 *
 * SINGLE CANONICAL HOME for the perineal-massage wording. The language
 * review (ACOG/NHS phrasing) landed Sept 20, 2026 and this copy is FINAL —
 * if legal asks for a wording change later, edit ONLY these constants;
 * the UI reads from them, so no screen churn is needed.
 *
 * HARD RULE (Anuraj, Sept 20, 2026): NEVER add pattern-triggered alerts or
 * wording like "you may be in labor" / "time to go to the hospital" to this
 * section without fresh copy and legal review.
 */

/** Kept per Anuraj's explicit decision (Sept 20, 2026). Ships as normal
 *  product UI — the mockup's "Candidate — cuttable" tag and Keep/Cut
 *  buttons were review affordances only and are NOT rendered. */
export const PERINEAL_COPY = {
  title: 'Perineal massage',
  introLead: 'Gentle stretching of the perineal tissues with clean hands.',
  introRest: 'Many people start around 34–35 weeks, for 5–10 minutes, a few times a week.',
  bullets: [
    'Use clean hands and a plain oil, like olive or sunflower oil.',
    'Gentle, steady pressure — never pain. Stop if anything feels wrong.',
    'Comfortable position: half-reclined, knees bent and supported.',
  ],
  safety:
    'Ask your provider first — skip it if you have a vaginal infection, any bleeding, or think your waters may have broken.',
} as const;

/** Rendered at the bottom of the section (guide + exercise states). */
export const DISCLAIMER =
  "This isn't medical advice — your care team knows your situation best.";

/** Guide-overview hero copy (final, from the mockup). */
export const HERO_COPY = {
  kicker: 'Final weeks · letting go',
  title: 'These weeks are for softening, not squeezing',
  intro: [
    { text: 'Your body already knows how to open for labor. These ', bold: false },
    { text: 'gentle practices', bold: true },
    { text: ' help you rehearse the feeling of ', bold: false },
    { text: 'release', bold: true },
    {
      text: ' — so "let go" feels familiar when it matters. Questions about what\u2019s right for you belong with ',
      bold: false,
    },
    { text: 'your provider or a pelvic-floor physical therapist', bold: true },
    { text: '.', bold: false },
  ],
} as const;
