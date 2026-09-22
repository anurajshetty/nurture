/**
 * Labor activities in the log feed — impure persistence (Willow,
 * mockup 32 rev 2 — Anuraj approved Sept 21, 2026).
 *
 * Device-only writers. Sessions save as ONE unified 'activity' event
 * type (Epic 2 vocabulary) carrying `data.activityKind` — the same
 * pattern as src/kicks/store.ts `saveKickSession`. Every save is
 * idempotent on `data.sessionKey` (see alreadySavedEvent in ./feed): a
 * double-fired completion handler can never write a duplicate card.
 * Never throws outward.
 */

import { getActivePregnancy, listEvents, saveEvent } from '../sync/store';
import { readShareDefaultSync } from '../partner/shareStore';
import type {
  ActivityCardData,
  BreathingActivityData,
  ContractionActivityData,
  PelvicFloorActivityData,
} from './feed';
import type { LocalEvent } from '../lib/types';

/** The timed-contraction shape from app/labor/contractions.tsx (structural). */
export interface TimedContraction {
  id: string;
  startedAt: string; // ISO 8601
  durationSec: number;
}

/**
 * Shared save: refuses when a live 'activity' card with the same
 * sessionKey already exists. Returns the saved (or existing) event,
 * null on failure. Never throws.
 */
function saveLaborEvent(
  sessionKey: string,
  occurredAt: string,
  data: ActivityCardData,
): LocalEvent | null {
  try {
    const existing = listEvents(300).find(
      (e) => e.deletedAt === null && e.type === 'activity' && e.data?.sessionKey === sessionKey,
    );
    if (existing) return existing;
    const pregnancy = getActivePregnancy();
    return saveEvent({
      type: 'activity',
      occurredAt,
      pregnancyId: pregnancy?.id ?? null,
      // Auto-saved: follows the global sharing default, no save-time UI
      // (mockup 33-entry-sharing, Anuraj approved Sept 21, 2026).
      visibility: readShareDefaultSync() ? 'shared' : 'private',
      data: { ...data, sessionKey } as Record<string, unknown>,
    });
  } catch {
    return null;
  }
}

/**
 * One feed card for a contraction-timing visit: the entries timed since
 * the timer screen mounted (newVisitEntries). Empty input saves nothing.
 * `occurredAt` = when the visit ended (now) — drives day-group placement.
 */
export function saveContractionSession(
  entries: readonly TimedContraction[],
  occurredAt: string = new Date().toISOString(),
): LocalEvent | null {
  if (entries.length === 0) return null;
  try {
    const sorted = [...entries].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const count = sorted.length;
    const newestMs = Date.parse(sorted[0].startedAt);
    const oldestMs = Date.parse(sorted[sorted.length - 1].startedAt);
    const spanSec = Math.max(1, (newestMs - oldestMs) / 1000 + sorted[0].durationSec);
    let intervalSum = 0;
    let intervalN = 0;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = Date.parse(sorted[i].startedAt);
      const b = Date.parse(sorted[i + 1].startedAt);
      if (!Number.isNaN(a) && !Number.isNaN(b) && a > b) {
        intervalSum += (a - b) / 1000;
        intervalN++;
      }
    }
    const avgIntervalSec = intervalN > 0 ? intervalSum / intervalN : null;
    const avgDurationSec =
      sorted.reduce((s, e) => s + Math.max(1, e.durationSec), 0) / count;
    const sessionKey = `contraction-${sorted[sorted.length - 1].startedAt}-${sorted[0].startedAt}-${count}`;
    const data: ContractionActivityData = {
      sessionKey,
      activityKind: 'contraction',
      count,
      spanSec,
      avgIntervalSec,
      avgDurationSec,
    };
    return saveLaborEvent(sessionKey, occurredAt, data);
  } catch {
    return null;
  }
}

/**
 * One feed card per completed breathing round. The session key binds the
 * pattern to the round's start stamp, so "Practice again" (a fresh
 * startedAtMs) is a new card while a double-fired done handler is not.
 */
export function saveBreathingRound(input: {
  patternId: string;
  patternName: string;
  startedAtMs: number;
  durationSec: number;
  rounds?: number;
  occurredAt?: string;
}): LocalEvent | null {
  try {
    const sessionKey = `breathing-${input.patternId}-${input.startedAtMs}`;
    const data: BreathingActivityData = {
      sessionKey,
      activityKind: 'breathing',
      patternId: input.patternId,
      patternName: input.patternName,
      rounds: Math.max(1, Math.round(input.rounds ?? 1)),
      durationSec: Math.max(1, Math.round(input.durationSec)),
    };
    return saveLaborEvent(
      sessionKey,
      input.occurredAt ?? new Date().toISOString(),
      data,
    );
  } catch {
    return null;
  }
}

/**
 * One feed card per completed pelvic-floor exercise session, saved at the
 * "well done" state (before the 2200ms auto-return). The caller passes
 * the sessionKey it minted when the session began.
 */
export function savePelvicFloorSession(input: {
  sessionKey: string;
  exerciseId: string;
  exerciseTitle: string;
  sets: number;
  durationSec: number;
  occurredAt?: string;
}): LocalEvent | null {
  try {
    const data: PelvicFloorActivityData = {
      sessionKey: input.sessionKey,
      activityKind: 'pelvicfloor',
      exerciseId: input.exerciseId,
      exerciseTitle: input.exerciseTitle,
      sets: Math.max(1, Math.round(input.sets)),
      durationMin: Math.max(1, Math.round(input.durationSec / 60)),
    };
    return saveLaborEvent(
      input.sessionKey,
      input.occurredAt ?? new Date().toISOString(),
      data,
    );
  } catch {
    return null;
  }
}
