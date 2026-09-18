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
  dirty: number;
}

/** Raw pregnancies-table row as returned by SQLite. */
interface PregnancyRow {
  id: string;
  user_id: string | null;
  due_date: string | null;
  lmp_date: string | null;
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
    dirty: row.dirty === 1,
  };
}

/**
 * Saves a journal event locally and queues it for upload.
 * Returns the saved event immediately; never waits for the network.
 */
export function saveEvent(input: EventInput): LocalEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const event: LocalEvent = {
    id: Crypto.randomUUID(),
    userId: input.userId ?? null,
    pregnancyId: input.pregnancyId ?? null,
    type: input.type,
    occurredAt: input.occurredAt ?? now,
    visibility: input.visibility ?? 'private',
    data: input.data ?? {},
    idempotencyKey: Crypto.randomUUID(),
    deletedAt: null,
    updatedAt: now,
    dirty: true,
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO events (id, user_id, pregnancy_id, type, occurred_at, visibility, data,
        idempotency_key, deleted_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
      event.id,
      event.userId,
      event.pregnancyId,
      event.type,
      event.occurredAt,
      event.visibility,
      JSON.stringify(event.data),
      event.idempotencyKey,
      event.updatedAt,
    );
    db.runSync(
      `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      Crypto.randomUUID(),
      event.id,
      now,
    );
  });
  return event;
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
    pregnancyType: input.pregnancyType ?? existing?.pregnancyType ?? 'singleton',
    parity: input.parity ?? existing?.parity ?? 'first',
    status: 'active',
    updatedAt: now,
    dirty: true,
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO pregnancies (id, user_id, due_date, lmp_date, pregnancy_type, parity, status, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         due_date = excluded.due_date,
         lmp_date = excluded.lmp_date,
         pregnancy_type = excluded.pregnancy_type,
         parity = excluded.parity,
         status = 'active',
         updated_at = excluded.updated_at,
         dirty = 1`,
      pregnancy.id,
      pregnancy.userId,
      pregnancy.dueDate,
      pregnancy.lmpDate,
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
