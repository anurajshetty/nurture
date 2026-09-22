/**
 * Kick counter — impure persistence (Willow, Anuraj approved Sept 20, 2026).
 *
 * Device-only writers. Sessions save through the real event store
 * (`kick_session` events, Epic 2 vocabulary); appointment attachments
 * rewrite `data.kickSessions` with the same transactional pattern as
 * src/plan/questions.ts `saveQuestions` (UPDATE + outbox upsert, never a
 * new table). Never throws outward.
 */

import { getDb } from '../lib/db';
import { listEvents, saveEvent, getActivePregnancy } from '../sync/store';
import { readShareDefaultSync } from '../partner/shareStore';
import { readAttachedKicks } from './appointments';
import { readKickSession } from './session';
import type { AttachedKickSession, KickSession, KickStrength } from './types';
import type { LocalEvent } from '../lib/types';

/**
 * Saves a finished counting session as a `kick_session` event.
 * `occurredAt` = when she started counting. Returns the saved event,
 * or null on failure (never throws).
 */
export function saveKickSession(input: {
  movements: number;
  durationSec: number;
  strength: KickStrength | null;
  occurredAt: string;
}): LocalEvent | null {
  try {
    const pregnancy = getActivePregnancy();
    return saveEvent({
      type: 'kick_session',
      occurredAt: input.occurredAt,
      pregnancyId: pregnancy?.id ?? null,
      // Auto-saved: follows the global sharing default, no save-time UI
      // (mockup 33-entry-sharing, Anuraj approved Sept 21, 2026).
      visibility: readShareDefaultSync() ? 'shared' : 'private',
      data: {
        movements: input.movements,
        durationSec: input.durationSec,
        durationMin: Math.round(input.durationSec / 60),
        ...(input.strength ? { strength: input.strength } : {}),
      },
    });
  } catch {
    return null;
  }
}

/** All kick sessions, newest first. Never throws. */
export function listKickSessions(): KickSession[] {
  try {
    const out: KickSession[] = [];
    for (const e of listEvents(500)) {
      const s = readKickSession(e);
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

/** True once she has saved at least one session — retires the Home card. */
export function hasKickSessions(): boolean {
  try {
    const row = getDb().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL AND type = 'kick_session'`,
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Persists a rewritten kick list for one appointment event: replaces
 * `data.kickSessions`, marks the row dirty, and queues an upsert so the
 * next text sync carries the change (same pattern as `saveQuestions`).
 * No-op when the event doesn't exist. Never throws.
 */
export function saveAttachedKicks(
  eventId: string,
  kicks: readonly AttachedKickSession[],
): boolean {
  try {
    const row = getDb().getFirstSync<{ data: string }>(
      'SELECT data FROM events WHERE id = ?',
      eventId,
    );
    if (!row) return false;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    // Re-read first so a concurrent question edit isn't clobbered: start
    // from the stored payload, replace only our key.
    void readAttachedKicks(data);
    data.kickSessions = kicks.map((k) => ({ ...k }));
    const now = new Date().toISOString();
    getDb().withTransactionSync(() => {
      getDb().runSync(
        'UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?',
        JSON.stringify(data),
        now,
        eventId,
      );
      getDb().runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
        `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        eventId,
        now,
      );
    });
    return true;
  } catch {
    return false;
  }
}
