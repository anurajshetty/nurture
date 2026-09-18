/**
 * Pure mood-pill window logic (Epic 2.1). Zero dependencies so the rule
 * is unit-testable without the database.
 */

/** The pill stays hidden for this long after a mood is logged. */
export const MOOD_WINDOW_MS = 4 * 3600 * 1000;

/**
 * True when the Mood pill should be shown: never logged, or the last
 * log is older than the 4-hour window.
 */
export function isMoodWindowElapsed(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt > MOOD_WINDOW_MS;
}
