/**
 * Kick counter — pure appointment-attachment logic (Willow, Anuraj approved
 * Sept 20, 2026).
 *
 * Locked rules (Anuraj, feedback round 3):
 * - A kick session attaches ONLY to the immediate next future appointment
 *   — never skips to a later one.
 * - Max 5 kick sessions per appointment; a full next appointment hides the
 *   feed card's save link.
 * - The save link appears only for sessions that deviate from her usual
 *   pattern (see src/kicks/pattern.ts).
 * - Once attached anywhere, the link hides for that session.
 *
 * Sessions are stored as snapshots on the appointment event's
 * `data.kickSessions` (same transactional rewrite pattern as
 * src/plan/questions.ts `saveQuestions`).
 *
 * Dependency-free (only erased type imports) — unit-testable under plain
 * node. Never throws outward.
 */

import { deviationReason } from './pattern';
import type { AttachedKickSession, KickSession } from './types';
import type { LocalEvent } from '../lib/types';

/** Anuraj: at most five kick sessions ride along to one appointment. */
export const MAX_KICKS_PER_APPOINTMENT = 5;

/**
 * The immediate next future appointment: smallest occurredAt strictly
 * after now. Callers pass non-deleted events (the store already excludes
 * tombstones). Pure.
 */
export function nextFutureAppointment(
  events: readonly LocalEvent[],
  nowMs: number,
): LocalEvent | null {
  let best: LocalEvent | null = null;
  for (const e of events) {
    if (e.type !== 'appointment') continue;
    const t = new Date(e.occurredAt).getTime();
    if (Number.isNaN(t) || t <= nowMs) continue;
    if (!best || t < new Date(best.occurredAt).getTime()) best = e;
  }
  return best;
}

/** Tolerant reader for `data.kickSessions`. Skips malformed entries. */
export function readAttachedKicks(
  data: Record<string, unknown> | undefined,
): AttachedKickSession[] {
  if (!data || !Array.isArray(data.kickSessions)) return [];
  const out: AttachedKickSession[] = [];
  for (const raw of data.kickSessions) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : null;
    const movements =
      typeof r.movements === 'number' && Number.isFinite(r.movements)
        ? Math.floor(r.movements)
        : null;
    const durationSec =
      typeof r.durationSec === 'number' && Number.isFinite(r.durationSec)
        ? Math.floor(r.durationSec)
        : null;
    const occurredAt =
      typeof r.occurredAt === 'string' ? r.occurredAt : null;
    if (!id || movements === null || movements < 0 || durationSec === null || !occurredAt)
      continue;
    const strength =
      r.strength === 'fluttery' || r.strength === 'usual' || r.strength === 'strong'
        ? r.strength
        : undefined;
    out.push({ id, movements, durationSec, occurredAt, ...(strength ? { strength } : {}) });
  }
  return out;
}

/** Snapshot a session for attachment. Pure. */
export function toAttachedKick(session: KickSession): AttachedKickSession {
  return {
    id: session.id,
    movements: session.movements,
    durationSec: session.durationSec,
    occurredAt: session.occurredAt,
    ...(session.strength ? { strength: session.strength } : {}),
  };
}

/**
 * Returns a new list with the session appended — unchanged when the
 * session is already attached or the list is at the 5-session cap. Pure.
 */
export function attachKick(
  kicks: readonly AttachedKickSession[],
  session: KickSession,
): AttachedKickSession[] {
  if (kicks.some((k) => k.id === session.id)) return [...kicks];
  if (kicks.length >= MAX_KICKS_PER_APPOINTMENT) return [...kicks];
  return [...kicks, toAttachedKick(session)];
}

/** Returns a new list without the session. Pure. */
export function detachKick(
  kicks: readonly AttachedKickSession[],
  kickId: string,
): AttachedKickSession[] {
  return kicks.filter((k) => k.id !== kickId);
}

/** True when the session id appears on any (non-deleted) appointment. */
export function isKickAttached(
  events: readonly LocalEvent[],
  kickId: string,
): boolean {
  for (const e of events) {
    if (e.type !== 'appointment') continue;
    if (readAttachedKicks(e.data).some((k) => k.id === kickId)) return true;
  }
  return false;
}

export interface SaveLinkInput {
  /** The session on this feed card. */
  session: KickSession;
  /** Her sessions before this one (for the deviation check). */
  prior: readonly KickSession[];
  /** All non-deleted events (for next-appointment + attached checks). */
  events: readonly LocalEvent[];
  nowMs: number;
}

/**
 * The full feed-card rule: the "Save to my next appointment" link shows
 * only when the session deviates from her usual pattern AND there is a
 * future appointment with room AND the session isn't already attached.
 * Pure.
 */
export function saveLinkVisible(input: SaveLinkInput): boolean {
  const { session, prior, events, nowMs } = input;
  if (deviationReason(session, prior) === null) return false;
  const next = nextFutureAppointment(events, nowMs);
  if (!next) return false;
  if (readAttachedKicks(next.data).length >= MAX_KICKS_PER_APPOINTMENT)
    return false;
  if (isKickAttached(events, session.id)) return false;
  return true;
}

/**
 * "Dr. Izu" from an appointment title like "Appointment with Dr. Izu".
 * Null when the title names nobody — the confirmation then reads
 * "Added to your Oct 2 appointment" with no invented name.
 */
export function doctorNameFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const m = title.match(/with\s+(.+?)\s*$/i);
  const name = m?.[1]?.trim();
  return name ? name : null;
}

/**
 * The save confirmation: "Added to your Oct 2 appointment with Dr. Izu".
 * Pure.
 */
export function attachConfirmation(
  appointment: LocalEvent,
  dateLabel: string,
): string {
  const title =
    typeof appointment.data.title === 'string'
      ? appointment.data.title
      : undefined;
  const doctor = doctorNameFromTitle(title);
  return doctor
    ? `Added to your ${dateLabel} appointment with ${doctor}`
    : `Added to your ${dateLabel} appointment`;
}
