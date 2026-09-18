/**
 * Smart Mood pill state (Epic 2.1).
 *
 * The Mood pill appears ONLY when no mood has been logged in the last
 * 4 hours (confirmed by Anuraj, Sept 17). One tap on a mood logs a
 * "Feeling X" moment; the pill then hides. Never required, never nagging.
 */

import { kvGet, kvSet } from '../lib/db';
import { isMoodWindowElapsed, MOOD_WINDOW_MS } from './moodWindow';

export { MOOD_WINDOW_MS };

export const MOODS = [
  { id: 'Radiant', glyph: '✦' },
  { id: 'Good', glyph: '◐' },
  { id: 'Okay', glyph: '○' },
  { id: 'Rough', glyph: '◑' },
  { id: 'Tired', glyph: '☾' },
] as const;

export type MoodId = (typeof MOODS)[number]['id'];

const LAST_MOOD_KEY = 'composer.lastMoodAt';

/** Epoch ms of the last logged mood, or null when never logged. Never throws. */
export function getLastMoodAt(): number | null {
  try {
    const raw = kvGet(LAST_MOOD_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

/** Records a mood log at `ts` (defaults to now). Never throws. */
export function setLastMoodAt(ts: number = Date.now()): void {
  try {
    kvSet(LAST_MOOD_KEY, String(ts));
  } catch {
    // Mood pill visibility is a nicety — never crash the composer over it.
  }
}

/** True when the Mood pill should be shown. */
export function shouldShowMoodPill(now: number = Date.now()): boolean {
  return isMoodWindowElapsed(getLastMoodAt(), now);
}
