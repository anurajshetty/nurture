/**
 * Kick counter — pure pattern + deviation logic (Willow, Anuraj approved
 * Sept 20, 2026).
 *
 * The feed card's "Save to my next appointment" link appears ONLY when a
 * session deviates from her usual pattern — never for ordinary sessions.
 * The history screen's gentle pattern line ("Usually about 15–20 minutes,
 * most evenings.") is computed here too.
 *
 * Locked rules:
 * - No grades, streaks, red/green verdicts, or safety claims. These
 *   functions return facts (averages, a mode) and one gentle flag reason;
 *   every user-facing line routes reduced movement to her provider.
 * - "Notably longer": the session ran at least 1.5× her recent average
 *   duration (needs ≥2 prior sessions — no pattern without history).
 * - "Notably weaker": her chosen strength dropped below her usual
 *   strength (the mode of prior sessions' strengths).
 * - When both apply, duration wins (it is the headline metric).
 *
 * Dependency-free (only erased type imports) — unit-testable under plain
 * node. Never throws outward.
 */

import { strengthLevel } from './session';
import type { KickSession, KickStrength } from './types';

export type DeviationReason = 'longer' | 'weaker';

/** Prior sessions needed before a pattern exists to deviate from. */
export const MIN_PRIOR_SESSIONS = 2;

/** How many recent sessions feed the pattern math. */
const RECENT_LIMIT = 5;

/** "Notably longer" threshold: 1.5× her recent average. */
const LONGER_FACTOR = 1.5;

/**
 * The most recent sessions, newest first, excluding one id. Pure.
 * `all` may be unsorted — this sorts by occurredAt descending.
 * `beforeOccurredAt` scopes the set to sessions at-or-before the current
 * one, so an older feed card is never compared against newer sessions.
 */
export function recentKickSessions(
  all: readonly KickSession[],
  excludeId?: string,
  limit: number = RECENT_LIMIT,
  beforeOccurredAt?: string,
): KickSession[] {
  return all
    .filter((s) => s.id !== excludeId)
    .filter(
      (s) =>
        beforeOccurredAt === undefined || s.occurredAt <= beforeOccurredAt,
    )
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, Math.max(0, limit));
}

/** Mean of positive durations, rounded. Null when there are none. */
export function averageDurationSec(
  sessions: readonly KickSession[],
): number | null {
  const ds = sessions
    .map((s) => s.durationSec)
    .filter((d) => d > 0);
  if (ds.length === 0) return null;
  return Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
}

/** Most common strength among prior sessions. Null when none was given. */
export function usualStrength(
  sessions: readonly KickSession[],
): KickStrength | null {
  const counts = new Map<KickStrength, number>();
  for (const s of sessions) {
    if (!s.strength) continue;
    counts.set(s.strength, (counts.get(s.strength) ?? 0) + 1);
  }
  let best: KickStrength | null = null;
  let bestN = 0;
  // Map preserves insertion order — ties resolve to the earliest seen,
  // which is the most recent session (list is newest-first). Stable.
  for (const [strength, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = strength;
    }
  }
  return best;
}

/**
 * Why this session deviates from her usual pattern, or null when it is
 * ordinary. `prior` = her sessions before this one (use
 * recentKickSessions(all, session.id)). Pure.
 */
export function deviationReason(
  session: KickSession,
  prior: readonly KickSession[],
): DeviationReason | null {
  const recent = prior.slice(0, RECENT_LIMIT);
  let longer = false;
  let weaker = false;

  if (recent.length >= MIN_PRIOR_SESSIONS && session.durationSec > 0) {
    const avg = averageDurationSec(recent);
    if (avg !== null && avg > 0 && session.durationSec >= avg * LONGER_FACTOR) {
      longer = true;
    }
  }

  if (session.strength && recent.length >= MIN_PRIOR_SESSIONS) {
    const usual = usualStrength(recent);
    if (
      usual &&
      strengthLevel(session.strength) < strengthLevel(usual)
    ) {
      weaker = true;
    }
  }

  if (longer) return 'longer';
  if (weaker) return 'weaker';
  return null;
}

/** True when the session differs from her usual pattern. Pure. */
export function isDeviating(
  session: KickSession,
  prior: readonly KickSession[],
): boolean {
  return deviationReason(session, prior) !== null;
}

/**
 * The history row's gentle note for a deviating session. Calm care
 * guidance, never a verdict — reduced movement routes to her provider.
 */
export function deviationNote(reason: DeviationReason): string {
  if (reason === 'longer') {
    return 'A bit longer than her usual — if she feels quieter than normal, your provider is the right call.';
  }
  return 'A little quieter than her usual — if that worries you, your provider is the right call.';
}

/* ------------------------------------------------------------------ */
/* Pattern summary ("Her pattern" card)                                */
/* ------------------------------------------------------------------ */

type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

function dayPartOf(iso: string): DayPart | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

const DAY_PART_PLURAL: Record<DayPart, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
  night: 'nights',
};

/**
 * "Usually about 15–20 minutes, most evenings." — the gentle pattern
 * summary. Needs ≥2 sessions with a duration; returns null before that
 * (the caller shows a warm "not yet" line). No verdicts, no streaks.
 * Pure.
 */
export function patternSummaryLine(
  sessions: readonly KickSession[],
): string | null {
  const recent = sessions.slice(0, 7);
  const minutes = recent
    .map((s) => s.durationSec)
    .filter((d) => d > 0)
    .map((d) => Math.max(1, Math.round(d / 60)));
  if (minutes.length < 2) return null;
  const lo = Math.min(...minutes);
  const hi = Math.max(...minutes);
  const durationPart =
    lo === hi ? `about ${lo} minutes` : `about ${lo}–${hi} minutes`;

  const counts = new Map<DayPart, number>();
  for (const s of recent) {
    const part = dayPartOf(s.occurredAt);
    if (part) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  let best: DayPart | null = null;
  let bestN = 0;
  let tied = false;
  for (const [part, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = part;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  const timePart =
    best && !tied ? `, most ${DAY_PART_PLURAL[best]}` : '';
  return `Usually ${durationPart}${timePart}.`;
}
