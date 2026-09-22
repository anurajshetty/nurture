/**
 * Local event store (Epic 0.5, write path).
 *
 * Offline-first: `saveEvent` / `deleteEvent` write to SQLite and enqueue an
 * outbox op, then return immediately — they never wait for the network.
 * `src/sync/engine.ts` drains the outbox when the backend is reachable.
 *
 * Media seam (later epic): text/data saves never wait for media uploads.
 * Callers attach media as `data` references (local URI or storage path);
 * a dedicated media uploader will attach the bytes to the photos/files
 * buckets and reconcile `data` during a future sync.
 */

import * as Crypto from 'expo-crypto';
import { getDb } from '../lib/db';
import { awaitIdentityUserId, getIdentityUserId, noteIdentityUserId } from '../auth/identity';
import type { EventAttachment, EventInput, LocalEvent, Pregnancy, Visibility } from '../lib/types';

/** Raw events-table row as returned by SQLite. */
interface EventRow {
  id: string;
  user_id: string | null;
  pregnancy_id: string | null;
  type: string;
  occurred_at: string;
  visibility: string;
  data: string;
  idempotency_key: string;
  deleted_at: string | null;
  updated_at: string;
  created_at: string | null;
  dirty: number;
}

/** Raw pregnancies-table row as returned by SQLite. */
interface PregnancyRow {
  id: string;
  user_id: string | null;
  due_date: string | null;
  lmp_date: string | null;
  owner_name: string | null;
  dob: string | null;
  pregnancy_type: string;
  parity: string;
  status: string;
  updated_at: string;
  dirty: number;
}

/** Converts a SQLite row into a typed LocalEvent. */
function rowToEvent(row: EventRow): LocalEvent {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    pregnancyId: row.pregnancy_id,
    type: row.type,
    occurredAt: row.occurred_at,
    visibility: (row.visibility as Visibility) ?? 'private',
    data,
    idempotencyKey: row.idempotency_key,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
    // created_at is NOT NULL from v6 on; the fallback covers rows read
    // from a database whose migration hasn't run yet (shouldn't happen —
    // applySchema runs at boot — but never return a hole).
    createdAt: row.created_at ?? row.occurred_at,
    dirty: row.dirty === 1,
  };
}

/**
 * Core event insert. `queueOutbox` false = local-only: the row is written
 * (visible in the feed, marked dirty) but no sync op is queued — used when
 * the identity is unavailable so we never queue a row that can never sync.
 * The identity-resolution sweep (`sweepIdentityPendingRows`) picks such
 * rows up once an identity exists.
 */
function writeEventRow(input: EventInput, queueOutbox: boolean): LocalEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const event: LocalEvent = {
    id: Crypto.randomUUID(),
    // Sync bug fix (Sept 2026): stamp the resolved anonymous identity when
    // known instead of always-null. Rows that still land with null user_id
    // (identity unresolved at creation) are healed at push time from the
    // live session — see pushOutbox in src/sync/engine.ts.
    userId: input.userId ?? getIdentityUserId() ?? null,
    pregnancyId: input.pregnancyId ?? null,
    type: input.type,
    occurredAt: input.occurredAt ?? now,
    visibility: input.visibility ?? 'private',
    data: input.data ?? {},
    idempotencyKey: Crypto.randomUUID(),
    deletedAt: null,
    updatedAt: now,
    // created_at is the immutable story position: appointment cards sort
    // by this in the feed (Anuraj, Sept 2026) — never rewritten afterwards.
    createdAt: now,
    dirty: true,
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO events (id, user_id, pregnancy_id, type, occurred_at, visibility, data,
        idempotency_key, deleted_at, updated_at, created_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)`,
      event.id,
      event.userId,
      event.pregnancyId,
      event.type,
      event.occurredAt,
      event.visibility,
      JSON.stringify(event.data),
      event.idempotencyKey,
      event.updatedAt,
      event.createdAt,
    );
    if (queueOutbox) {
      db.runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
        Crypto.randomUUID(),
        event.id,
        now,
      );
    }
  });
  return event;
}

/**
 * Saves a journal event locally and queues it for upload.
 * Returns the saved event immediately; never waits for the network.
 */
export function saveEvent(input: EventInput): LocalEvent {
  return writeEventRow(input, true);
}

/**
 * Creation gate (sync bug fix, Sept 2026): awaits identity resolution
 * before stamping `user_id`, so entries created in the pre-boot race get
 * the right owner instead of null.
 *
 * - Identity resolves → the entry is stamped and queued normally.
 * - Identity still unavailable after the wait → the entry is kept
 *   local-only (visible in the feed, dirty, no outbox op): never queue a
 *   row that can never sync. `sweepIdentityPendingRows` stamps and queues
 *   it once an identity exists; push-time healing is the final backstop.
 *
 * Resolves immediately when boot already settled — the common case adds
 * no latency.
 */
export async function saveEventAwaitingIdentity(input: EventInput): Promise<LocalEvent> {
  if (input.userId !== undefined && input.userId !== null) {
    return writeEventRow(input, true);
  }
  const userId = await awaitIdentityUserId();
  if (userId) {
    return writeEventRow({ ...input, userId }, true);
  }
  return writeEventRow({ ...input, userId: null }, false);
}

/**
 * Stamps the now-known identity onto local rows that were created while
 * it was unavailable, and queues an upsert for rows that were kept
 * local-only (no outbox op yet). Rows that already have ops are healed
 * again at push time. Returns the number of rows stamped.
 *
 * Best-effort: throws when the DB isn't ready yet (web before
 * ensureDbReady); callers catch and rely on push-time healing instead.
 */
export function sweepIdentityPendingRows(userId: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const pending = db.getAllSync<{ id: string; has_op: number }>(
    `SELECT e.id AS id,
            (SELECT COUNT(*) FROM outbox o WHERE o.event_id = e.id AND o.op = 'upsert') AS has_op
       FROM events e
      WHERE e.user_id IS NULL AND e.deleted_at IS NULL`,
  );
  if (pending.length === 0) return 0;
  db.withTransactionSync(() => {
    db.runSync('UPDATE events SET user_id = ? WHERE user_id IS NULL', userId);
    for (const row of pending) {
      if (row.has_op === 0) {
        db.runSync(
          `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
          Crypto.randomUUID(),
          row.id,
          now,
        );
      }
    }
  });
  return pending.length;
}

/**
 * Counts local (non-deleted) events still waiting on an identity —
 * the "visibly pending" set for engineering diagnostics.
 */
export function getIdentityPendingCount(): number {
  const row = getDb().getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM events WHERE user_id IS NULL AND deleted_at IS NULL',
  );
  return row?.n ?? 0;
}

/**
 * Single entry point for "the identity resolved to this (possibly null)
 * value": records it in the shared cache and, when an identity exists,
 * sweeps rows that were created while it was unavailable. Called by the
 * boot hook and by AuthProvider's session subscription — nowhere else.
 * The sweep is best-effort (web DB may not be ready yet); push-time
 * healing covers whatever the sweep misses.
 */
export function onIdentityResolved(userId: string | null): void {
  noteIdentityUserId(userId);
  if (userId) {
    try {
      sweepIdentityPendingRows(userId);
    } catch {
      // Push-time healing (src/sync/engine.ts) is the backstop.
    }
  }
}

/**
 * Flip an entry's shared state (mockup 33 entry-sharing, Anuraj approved
 * Sept 21, 2026): the retroactive per-entry toggle on feed cards. Updates
 * the local visibility and queues an upsert so the server's generated
 * events.shared follows. updated_at is rewritten; created_at (story
 * position) is never touched.
 */
export function updateEventVisibility(id: string, visibility: Visibility): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync(
      'UPDATE events SET visibility = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL',
      visibility,
      now,
      id,
    );
    db.runSync(
      `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      Crypto.randomUUID(),
      id,
      now,
    );
  });
}

/**
 * Soft-deletes an event: sets a local tombstone and queues a delete op.
 * The tombstone is kept until the server acknowledges the delete.
 */
export function deleteEvent(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('UPDATE events SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?', now, now, id);
    db.runSync(
      `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'delete', 0, ?)`,
      Crypto.randomUUID(),
      id,
      now,
    );
  });
}

/**
 * Hard-deletes an event: removes the row AND its pending outbox ops, then
 * enqueues a 'delete' op so the tombstone still converges if the row was
 * already pushed (a user-initiated sync during the summarize window).
 * Reserved for ephemeral entries that must leave no trace (report-summary
 * failures: Anuraj Sept 2026 — a failed or off-topic report leaves no
 * card and no feed entry, ever). Never throws.
 */
export function hardDeleteEvent(id: string): void {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM outbox WHERE event_id = ?', id);
      db.runSync('DELETE FROM events WHERE id = ?', id);
      db.runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'delete', 0, ?)`,
        Crypto.randomUUID(),
        id,
        now,
      );
    });
  } catch {
    // Best-effort: callers treat a failed delete as a no-op.
  }
}

/** Fetches one local event by id, or null when absent. */
export function getEvent(id: string): LocalEvent | null {
  const row = getDb().getFirstSync<EventRow>('SELECT * FROM events WHERE id = ?', id);
  return row ? rowToEvent(row) : null;
}

/**
 * Rewrites an event's attachment list (Epic 2.3): updates `data.attachments`,
 * marks the event dirty, and queues an upsert so the next text sync carries
 * the new metadata (upload status / storage paths) to the server and other
 * devices. No-op when the event doesn't exist.
 */
export function setEventAttachments(id: string, attachments: EventAttachment[]): void {
  const db = getDb();
  const row = db.getFirstSync<{ data: string }>('SELECT data FROM events WHERE id = ?', id);
  if (!row) return;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  data.attachments = attachments;
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?', JSON.stringify(data), now, id);
    db.runSync(
      `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      Crypto.randomUUID(),
      id,
      now,
    );
  });
}

/** Lists local (non-deleted) events, newest first. */
export function listEvents(limit = 200): LocalEvent[] {
  return getDb()
    .getAllSync<EventRow>(
      'SELECT * FROM events WHERE deleted_at IS NULL ORDER BY occurred_at DESC LIMIT ?',
      limit,
    )
    .map(rowToEvent);
}

/**
 * Lists one page of local (non-deleted) events, newest first — the
 * pagination primitive behind the virtualized timeline.
 *
 * Story order (Anuraj, Sept 2026): every new report, log, or appointment
 * goes to the top of the current week's feed section, so the feed sorts
 * by the immutable created_at — never by subject date (not the
 * appointment's scheduled date, not a report's document date). The
 * COALESCE covers rows whose migration hasn't backfilled yet.
 */
export function listEventsPage(limit: number, offset: number): LocalEvent[] {
  return getDb()
    .getAllSync<EventRow>(
      `SELECT * FROM events WHERE deleted_at IS NULL
       ORDER BY COALESCE(created_at, occurred_at) DESC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    )
    .map(rowToEvent);
}

/** Counts local (non-deleted) events — drives timeline pagination. */
export function countEvents(): number {
  const row = getDb().getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL',
  );
  return row?.n ?? 0;
}

/**
 * Lists local (non-deleted) events whose calendar day falls in
 * [startISO, endISO), newest first. The day is matched on the YYYY-MM-DD
 * date part of `occurred_at`, so look-back windows line up with the device's
 * calendar — the same day buckets the timeline's week bands use.
 */
export function listEventsInRange(startISO: string, endISO: string, limit = 50): LocalEvent[] {
  return getDb()
    .getAllSync<EventRow>(
      `SELECT * FROM events
       WHERE deleted_at IS NULL
         AND substr(occurred_at, 1, 10) >= ?
         AND substr(occurred_at, 1, 10) < ?
       ORDER BY occurred_at DESC LIMIT ?`,
      startISO,
      endISO,
      limit,
    )
    .map(rowToEvent);
}

/**
 * Test-only: deletes every event row and its outbox ops. Used by the
 * interactive web test harness to reset the timeline between runs.
 * Never called from production paths.
 */
export function clearAllEvents(): void {
  getDb().withTransactionSync(() => {
    getDb().runSync('DELETE FROM outbox');
    getDb().runSync('DELETE FROM events');
  });
}

/** Lists every local event including tombstones (used by export). */
export function listAllEventsIncludingDeleted(): LocalEvent[] {
  return getDb()
    .getAllSync<EventRow>('SELECT * FROM events ORDER BY occurred_at DESC')
    .map(rowToEvent);
}

/** Counts outbox ops waiting to be pushed. */
export function getPendingCount(): number {
  const row = getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

/** Lists local pregnancies, newest first. */
export function listPregnancies(): Pregnancy[] {
  return getDb()
    .getAllSync<PregnancyRow>('SELECT * FROM pregnancies ORDER BY updated_at DESC')
    .map(rowToPregnancy);
}

/** Converts a SQLite row into a typed Pregnancy. */
function rowToPregnancy(row: PregnancyRow): Pregnancy {
  return {
    id: row.id,
    userId: row.user_id,
    dueDate: row.due_date,
    lmpDate: row.lmp_date,
    ownerName: row.owner_name,
    dob: row.dob,
    pregnancyType: (row.pregnancy_type as Pregnancy['pregnancyType']) ?? 'singleton',
    parity: (row.parity as Pregnancy['parity']) ?? 'first',
    status: (row.status as Pregnancy['status']) ?? 'active',
    updatedAt: row.updated_at,
    dirty: row.dirty === 1,
  };
}

/** Input for creating (or replacing) the active pregnancy. Null dates = not set yet. */
export interface PregnancyInput {
  userId?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  lmpDate?: string | null; // YYYY-MM-DD
  /** Her name. undefined = keep existing; null = clear. */
  ownerName?: string | null;
  /** Her birthday, YYYY-MM-DD. undefined = keep existing; null = clear. */
  dob?: string | null;
  pregnancyType?: Pregnancy['pregnancyType'];
  parity?: Pregnancy['parity'];
}

/** Queues a pregnancy upsert op. The engine drains it when the backend is reachable. */
function enqueuePregnancyUpsert(pregnancyId: string, now: string): void {
  getDb().runSync(
    `INSERT INTO pregnancy_outbox (id, pregnancy_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
    Crypto.randomUUID(),
    pregnancyId,
    now,
  );
}

/**
 * The one active pregnancy (v1 tracks a single active pregnancy per device).
 * Null when onboarding hasn't created one yet.
 */
export function getActivePregnancy(): Pregnancy | null {
  const row = getDb().getFirstSync<PregnancyRow>(
    `SELECT * FROM pregnancies WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`,
  );
  return row ? rowToPregnancy(row) : null;
}

/**
 * Creates the active pregnancy, or updates it when one already exists
 * (keeps the same id so sync stays stable). Writes locally and queues an
 * upload; returns immediately and never waits for the network.
 */
export function savePregnancy(input: PregnancyInput): Pregnancy {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getActivePregnancy();
  const id = existing?.id ?? Crypto.randomUUID();
  // undefined = keep the existing value; null = explicitly clear it.
  const pregnancy: Pregnancy = {
    id,
    userId: input.userId !== undefined ? input.userId : (existing?.userId ?? null),
    dueDate: input.dueDate !== undefined ? input.dueDate : (existing?.dueDate ?? null),
    lmpDate: input.lmpDate !== undefined ? input.lmpDate : (existing?.lmpDate ?? null),
    ownerName: input.ownerName !== undefined ? input.ownerName : (existing?.ownerName ?? null),
    dob: input.dob !== undefined ? input.dob : (existing?.dob ?? null),
    pregnancyType: input.pregnancyType ?? existing?.pregnancyType ?? 'singleton',
    parity: input.parity ?? existing?.parity ?? 'first',
    status: 'active',
    updatedAt: now,
    dirty: true,
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO pregnancies (id, user_id, due_date, lmp_date, owner_name, dob, pregnancy_type, parity, status, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         due_date = excluded.due_date,
         lmp_date = excluded.lmp_date,
         owner_name = excluded.owner_name,
         dob = excluded.dob,
         pregnancy_type = excluded.pregnancy_type,
         parity = excluded.parity,
         status = 'active',
         updated_at = excluded.updated_at,
         dirty = 1`,
      pregnancy.id,
      pregnancy.userId,
      pregnancy.dueDate,
      pregnancy.lmpDate,
      pregnancy.ownerName,
      pregnancy.dob,
      pregnancy.pregnancyType,
      pregnancy.parity,
      pregnancy.updatedAt,
    );
    enqueuePregnancyUpsert(pregnancy.id, now);
  });
  return pregnancy;
}

/**
 * Patches the active pregnancy (e.g. a later due-date change) and queues
 * an upload. Returns the updated pregnancy, or null when none exists.
 * Omitted fields keep their values; explicit null clears a date.
 */
export function updatePregnancy(patch: PregnancyInput): Pregnancy | null {
  if (!getActivePregnancy()) return null;
  return savePregnancy(patch);
}

/** Counts pregnancy ops waiting to be pushed. */
export function getPendingPregnancyCount(): number {
  const row = getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM pregnancy_outbox');
  return row?.n ?? 0;
}
