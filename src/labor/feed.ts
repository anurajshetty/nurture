/**
 * Labor activities in the log feed (Willow, mockup 32 rev 2 — Anuraj
 * approved Sept 21, 2026).
 *
 * ONE unified feed card for every labor activity: the kicker reads
 * "Activity" (EventCard's TYPE_META) and the card itself names which
 * activity it is ("Contraction timing" / "Breathing" / "Pelvic floor").
 * This supersedes the earlier per-activity card types — they were never
 * released, so nothing ships under those names.
 *
 * Pure card-copy module: no database, no expo, no react-native imports —
 * unit-testable in plain node (see tests/labor_feed.test.ts).
 *
 * Card shape mirrors the kick session card (mockups 22/23): kicker /
 * main / sub, plus the provider line ONLY on contraction cards (Anuraj's
 * call — breathing and pelvic-floor cards are pure activity records).
 *
 * The card body intentionally does NOT repeat the time: EventCard's meta
 * row already shows "Today · 7:42 PM" next to the type label (the same
 * convention as the shipped kick card — formatMovementsLine carries no
 * time either, even though its HTML mockup showed one). The mockup's
 * "Breathing · 9:15 PM" main line is the standalone-HTML stand-in for
 * that meta row.
 *
 * Copy rules (locked): warm, minimal, general-information-only. No
 * streaks, no red/green verdicts, no triage language ("you may be in
 * labor", "go to the hospital"), no "baby is fine", no 5-1-1 on cards.
 */

/** Approved verbatim provider line — contraction activity ONLY. */
export const CONTRACTION_PROVIDER_LINE =
  'Your care team knows your situation best.';

/** Which labor activity a unified Activity card names inside. */
export type ActivityKind = 'contraction' | 'breathing' | 'pelvicfloor';

/** The activity name shown inside the card (Anuraj: "inside it tells which activity"). */
export const ACTIVITY_NAMES: Record<ActivityKind, string> = {
  contraction: 'Contraction timing',
  breathing: 'Breathing',
  pelvicfloor: 'Pelvic floor',
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * "1 hour 20 minutes" / "45 minutes" / "2 hours" / "45 seconds" —
 * the session-span wording for the contraction sub line.
 */
export function formatSpan(totalSec: number): string {
  const s = Math.max(1, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${plural(h, 'hour', 'hours')} ${plural(m, 'minute', 'minutes')}` : plural(h, 'hour', 'hours');
  }
  if (m > 0) return plural(m, 'minute', 'minutes');
  return plural(s, 'second', 'seconds');
}

/** "12 minutes" / "1 minute". */
export function formatMinutes(totalSec: number): string {
  const m = Math.max(1, Math.round(totalSec / 60));
  return plural(m, 'minute', 'minutes');
}

/** "45 seconds" / "1 second". */
export function formatSecs(totalSec: number): string {
  const s = Math.max(1, Math.round(totalSec));
  return plural(s, 'second', 'seconds');
}

/* ------------------------------------------------------------------ */
/* Unified Activity-card data payload. Written by src/labor/feedStore.  */
/* ts, read by src/labor/LaborFeedSection.tsx. `sessionKey` is the      */
/* idempotency key: the store refuses to save a second live card with  */
/* the same key, so double-fired completion handlers can never         */
/* duplicate a card.                                                   */
/* ------------------------------------------------------------------ */

/** One feed card per contraction-timing visit (≥1 contraction timed). */
export interface ContractionActivityData {
  sessionKey: string;
  activityKind: 'contraction';
  count: number;
  spanSec: number;
  avgIntervalSec: number | null;
  avgDurationSec: number;
}

/** One feed card per completed breathing round. */
export interface BreathingActivityData {
  sessionKey: string;
  activityKind: 'breathing';
  patternId: string;
  patternName: string;
  rounds: number;
  durationSec: number;
}

/** One feed card per completed guided pelvic-floor session. */
export interface PelvicFloorActivityData {
  sessionKey: string;
  activityKind: 'pelvicfloor';
  exerciseId: string;
  exerciseTitle: string;
  sets: number;
  durationMin: number;
}

export type ActivityCardData =
  | ContractionActivityData
  | BreathingActivityData
  | PelvicFloorActivityData;

function cleanNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Forgiving reader: malformed cards render nothing, never crash. Returns
 * null for unknown activity kinds too, so future kinds can't break the
 * feed.
 */
export function readActivityCard(
  data: Record<string, unknown> | undefined,
): ActivityCardData | null {
  if (!data) return null;
  const sessionKey = cleanStr(data.sessionKey);
  const kind = cleanStr(data.activityKind);
  if (!sessionKey) return null;
  try {
    if (kind === 'contraction') {
      const count = cleanNum(data.count);
      const spanSec = cleanNum(data.spanSec);
      const avgDurationSec = cleanNum(data.avgDurationSec);
      if (count === null || spanSec === null || avgDurationSec === null) return null;
      return {
        sessionKey,
        activityKind: 'contraction',
        count: Math.max(1, Math.round(count)),
        spanSec,
        avgIntervalSec: cleanNum(data.avgIntervalSec),
        avgDurationSec,
      };
    }
    if (kind === 'breathing') {
      const patternId = cleanStr(data.patternId);
      const patternName = cleanStr(data.patternName);
      const rounds = cleanNum(data.rounds);
      const durationSec = cleanNum(data.durationSec);
      if (!patternId || !patternName || rounds === null || durationSec === null) return null;
      return {
        sessionKey,
        activityKind: 'breathing',
        patternId,
        patternName,
        rounds: Math.max(1, Math.round(rounds)),
        durationSec,
      };
    }
    if (kind === 'pelvicfloor') {
      const exerciseId = cleanStr(data.exerciseId);
      const exerciseTitle = cleanStr(data.exerciseTitle);
      const sets = cleanNum(data.sets);
      const durationMin = cleanNum(data.durationMin);
      if (!exerciseId || !exerciseTitle || sets === null || durationMin === null) return null;
      return {
        sessionKey,
        activityKind: 'pelvicfloor',
        exerciseId,
        exerciseTitle,
        sets: Math.max(1, Math.round(sets)),
        durationMin,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * "6 contractions in 1 hour 20 minutes · about 12 minutes apart,
 * 45 seconds long on average." A single contraction has no interval, so
 * it reports duration only.
 */
export function formatContractionSub(
  count: number,
  spanSec: number,
  avgIntervalSec: number | null,
  avgDurationSec: number,
): string {
  if (count <= 1 || avgIntervalSec === null) {
    return `1 contraction \u00b7 about ${formatSecs(avgDurationSec)} long.`;
  }
  return `${plural(count, 'contraction', 'contractions')} in ${formatSpan(spanSec)} \u00b7 about ${formatMinutes(avgIntervalSec)} apart, ${formatSecs(avgDurationSec)} long on average.`;
}

/** "Slow-paced breathing · 1 round · a full minute, opened and closed with a cleansing breath." */
export function formatBreathingSub(
  patternName: string,
  rounds: number,
  durationSec: number,
): string {
  let note: string;
  if (durationSec <= 75) {
    note = 'a full minute, opened and closed with a cleansing breath.';
  } else {
    const m = Math.max(2, Math.round(durationSec / 60));
    note = `about ${plural(m, 'minute', 'minutes')}, opened and closed with a cleansing breath.`;
  }
  return `${patternName} \u00b7 ${plural(rounds, 'round', 'rounds')} \u00b7 ${note}`;
}

/** "Connection breath · 3 sets · gentle guided practice, about 5 minutes." */
export function formatPelvicFloorSub(
  exerciseTitle: string,
  sets: number,
  durationMin: number,
): string {
  const m = Math.max(1, Math.round(durationMin));
  return `${exerciseTitle} \u00b7 ${plural(sets, 'set', 'sets')} \u00b7 gentle guided practice, about ${plural(m, 'minute', 'minutes')}.`;
}

/** The card's sub line for any unified Activity card. */
export function activitySub(card: ActivityCardData): string {
  switch (card.activityKind) {
    case 'contraction':
      return formatContractionSub(card.count, card.spanSec, card.avgIntervalSec, card.avgDurationSec);
    case 'breathing':
      return formatBreathingSub(card.patternName, card.rounds, card.durationSec);
    case 'pelvicfloor':
      return formatPelvicFloorSub(card.exerciseTitle, card.sets, card.durationMin);
  }
}

/** The provider line appears ONLY on contraction-timing cards. */
export function activityProviderLine(card: ActivityCardData): string | null {
  return card.activityKind === 'contraction' ? CONTRACTION_PROVIDER_LINE : null;
}

/* ------------------------------------------------------------------ */
/* One-card-per-visit rule (contraction timer).                         */
/*                                                                     */
/* The timer screen snapshots the contraction ids present at mount; on  */
/* unmount, any id NOT in the snapshot was timed during that visit.     */
/* Deletions and edits of older entries never create cards.             */
/* ------------------------------------------------------------------ */

export interface VisitEntry {
  id: string;
}

/** Entries in `current` whose id was absent from the mount snapshot. */
export function newVisitEntries<T extends VisitEntry>(
  baselineIds: ReadonlySet<string> | readonly string[],
  current: readonly T[],
): T[] {
  const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds);
  return current.filter((e) => !baseline.has(e.id));
}

/**
 * Idempotency guard (pure half): true when a live (non-tombstoned)
 * 'activity' event already carries `sessionKey` in its data. The store
 * checks this before every save, so a double-fired completion handler
 * can never write a duplicate card.
 */
export function alreadySavedEvent(
  events: ReadonlyArray<{ type: string; deletedAt: string | null; data: Record<string, unknown> }>,
  sessionKey: string,
): boolean {
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    if (e.type !== 'activity') continue;
    if (e.data && e.data.sessionKey === sessionKey) return true;
  }
  return false;
}
