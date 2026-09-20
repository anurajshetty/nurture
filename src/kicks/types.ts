/**
 * Kick counter — shared shapes (Willow, Anuraj approved Sept 20, 2026).
 *
 * A kick-counting session is a `kick_session` event (Epic 2 vocabulary).
 * The session payload lives on the event's `data` blob — no new table,
 * no migration:
 *
 *   data: {
 *     movements: number,     // tap count (kicks, flutters, rolls)
 *     durationSec: number,    // elapsed counting time, pauses excluded
 *     durationMin: number,    // rounded minutes (obVisit export compat)
 *     strength?: 'fluttery' | 'usual' | 'strong',  // optional, her words
 *   }
 *
 * Sessions attached to an appointment live on the appointment event's
 * `data.kickSessions` — snapshots of the session at attach time
 * (Anuraj: max 5 per appointment, immediate next appointment only).
 */
export type KickStrength = 'fluttery' | 'usual' | 'strong';

/** A parsed kick-counting session, as the UI renders it. */
export interface KickSession {
  id: string;
  movements: number;
  /** Elapsed counting seconds (pauses excluded). */
  durationSec: number;
  strength: KickStrength | null;
  /** ISO start of the session. */
  occurredAt: string;
}

/** A session snapshot attached to an appointment's `data.kickSessions`. */
export interface AttachedKickSession {
  /** The kick_session event id — dedupe + "already attached" key. */
  id: string;
  movements: number;
  durationSec: number;
  strength?: KickStrength;
  occurredAt: string;
}
