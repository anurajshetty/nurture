/**
 * Epic 9 "Gentle reads" — the compassionate support module for the
 * afterwards Home.
 *
 * PLACEHOLDER CONTENT (Anuraj's call, Epic 9 design notes): the real titles
 * come from the reviewed content pack, which is still open. These are
 * gentle, non-alarming placeholder titles — never alarming, never clinical,
 * never advice. Never describe this content as clinician-reviewed.
 *
 * Rules this module follows, always:
 * - Never asks why.
 * - Never requests clinical details.
 * - Plain language; "pregnancy loss" is approved phrasing.
 * - No timelines, no checklists, no "should".
 */

import type { GentleRead } from '../lib/types';

export const GENTLE_READS_INTRO =
  'Short, gentle support for hard days. No advice, no checklists — take what helps, leave the rest.';

export const GENTLE_READS: GentleRead[] = [
  {
    id: 'coping-with-loss',
    title: 'Coping with pregnancy loss',
    blurb: 'Gentle words for the early days. There is no right way through this.',
  },
  {
    id: 'talking-about-it',
    title: 'Talking about it with people you love',
    blurb: 'When — and whether — to share, in your own words.',
  },
  {
    id: 'whats-next',
    title: "When you're ready: what's next",
    blurb: 'No rush. For whenever the question arrives.',
  },
];

/** Placeholder rows are tappable but open nothing yet — one honest line. */
export const GENTLE_READ_COMING_SOON =
  'These reads are still being prepared — they’ll be here when you need them.';
