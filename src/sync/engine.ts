/**
 * Offline-first sync engine (Epic 0.5, extended in Epic 1).
 *
 * `syncNow()` drains the local outbox (upserts keyed on `idempotency_key`,
 * deletes applied as tombstones) and pulls newer server rows — for both
 * `events` and `pregnancies`. The pregnancy record created by onboarding
 * travels the same path: local write first, `pregnancy_outbox` op, push
 * when reachable. It no-ops cleanly when the backend is unconfigured or
 * no session exists.
 *
 * Conflict policy: if a pulled server row is newer than a locally-dirty row
 * and the payloads differ, the engine does NOT merge — it records the pair
 * in the local conflicts table (kind 'event' or 'pregnancy') and moves on.
 * The user resolves each one via `resolveConflict(id, 'local' | 'remote')`.
 */

import * as Crypto from 'expo-crypto';
import { supabase, isConfigured } from '../lib/supabase';
import { getDb, kvGet, kvSet } from '../lib/db';
import type { LocalEvent, Pregnancy, SyncConflict, Visibility } from '../lib/types';

const LAST_SYNCED_KEY = 'sync.last_synced_at';
const LAST_SYNCED_PREGNANCIES_KEY = 'sync.last_synced_pregnancies_at';
const PULL_PAGE_SIZE = 500;

/** Summary of one sync pass. */
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

/** Raw outbox row as returned by SQLite. */
interface OutboxRow {
  id: string;
  event_id: string;
  op: 'upsert' | 'delete';
  attempts: number;
  created_at: string;
}

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

/** Server `events` row shape (jsonb arrives as an object). */
interface ServerEvent {
  id: string;
  user_id: string | null;
  pregnancy_id: string | null;
  type: string;
  occurred_at: string;
  visibility: Visibility;
  data: Record<string, unknown> | null;
  idempotency_key: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Converts a SQLite row to a typed LocalEvent. */
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

/** Converts a server row to a typed LocalEvent (marked clean). */
function serverToEvent(s: ServerEvent): LocalEvent {
  return {
    id: s.id,
    userId: s.user_id,
    pregnancyId: s.pregnancy_id,
    type: s.type,
    occurredAt: s.occurred_at,
    visibility: s.visibility ?? 'private',
    data: s.data ?? {},
    idempotencyKey: s.idempotency_key ?? s.id,
    deletedAt: s.deleted_at,
    updatedAt: s.updated_at,
    dirty: false,
  };
}

/** Finds the local row matching a server row, by id first, then idempotency key. */
function findLocalRow(s: ServerEvent): LocalEvent | null {
  const db = getDb();
  let row = db.getFirstSync<EventRow>('SELECT * FROM events WHERE id = ?', s.id);
  if (!row && s.idempotency_key) {
    row = db.getFirstSync<EventRow>('SELECT * FROM events WHERE idempotency_key = ?', s.idempotency_key);
  }
  return row ? rowToEvent(row) : null;
}

/** Pushes pending outbox ops to Supabase; per-op failures bump `attempts` and are skipped. */
async function pushOutbox(result: SyncResult): Promise<void> {
  const client = supabase!;
  const db = getDb();
  const ops = db.getAllSync<OutboxRow>('SELECT * FROM outbox ORDER BY created_at ASC');
  for (const op of ops) {
    try {
      if (op.op === 'upsert') {
        const row = db.getFirstSync<EventRow>('SELECT * FROM events WHERE id = ?', op.event_id);
        if (!row) {
          db.runSync('DELETE FROM outbox WHERE id = ?', op.id);
          continue;
        }
        const { error } = await client.from('events').upsert(
          {
            id: row.id,
            user_id: row.user_id,
            pregnancy_id: row.pregnancy_id,
            type: row.type,
            occurred_at: row.occurred_at,
            visibility: row.visibility,
            data: JSON.parse(row.data || '{}'),
            idempotency_key: row.idempotency_key,
            deleted_at: row.deleted_at,
            updated_at: row.updated_at,
          },
          { onConflict: 'idempotency_key' },
        );
        if (error) throw new Error(error.message);
        db.withTransactionSync(() => {
          db.runSync('UPDATE events SET dirty = 0 WHERE id = ?', op.event_id);
          db.runSync('DELETE FROM outbox WHERE id = ?', op.id);
        });
        result.pushed += 1;
      } else {
        const row = db.getFirstSync<EventRow>('SELECT * FROM events WHERE id = ?', op.event_id);
        if (!row) {
          db.runSync('DELETE FROM outbox WHERE id = ?', op.id);
          continue;
        }
        const tombstone = row.deleted_at ?? new Date().toISOString();
        const { error } = await client
          .from('events')
          .update({ deleted_at: tombstone, updated_at: tombstone })
          .eq('idempotency_key', row.idempotency_key);
        if (error) throw new Error(error.message);
        db.runSync('DELETE FROM outbox WHERE id = ?', op.id);
        result.pushed += 1;
      }
    } catch (e) {
      db.runSync('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', op.id);
      result.errors.push(`push ${op.op} ${op.event_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Records an event conflict pair locally; user content is never merged automatically. */
function recordEventConflict(local: LocalEvent, remote: LocalEvent): void {
  recordConflict('event', local.id, JSON.stringify(local), JSON.stringify(remote));
}

/** Applies one pulled server row to the local store (conflict-aware). */
function applyServerRow(s: ServerEvent, result: SyncResult): void {
  const db = getDb();
  const local = findLocalRow(s);
  const remote = serverToEvent(s);
  if (!local) {
    db.runSync(
      `INSERT OR REPLACE INTO events (id, user_id, pregnancy_id, type, occurred_at, visibility,
        data, idempotency_key, deleted_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      s.id,
      s.user_id,
      s.pregnancy_id,
      s.type,
      s.occurred_at,
      remote.visibility,
      JSON.stringify(remote.data),
      remote.idempotencyKey,
      s.deleted_at,
      s.updated_at,
    );
    result.pulled += 1;
    return;
  }
  if (!local.dirty) {
    db.runSync(
      `UPDATE events SET user_id = ?, pregnancy_id = ?, type = ?, occurred_at = ?,
        visibility = ?, data = ?, deleted_at = ?, updated_at = ?, dirty = 0 WHERE id = ?`,
      s.user_id,
      s.pregnancy_id,
      s.type,
      s.occurred_at,
      remote.visibility,
      JSON.stringify(remote.data),
      s.deleted_at,
      s.updated_at,
      local.id,
    );
    result.pulled += 1;
    return;
  }
  // Local row has unsynced edits. Surface a conflict instead of merging —
  // unless the payloads are identical, in which case there is nothing to fight over.
  const samePayload =
    JSON.stringify(local.data) === JSON.stringify(remote.data) &&
    local.deletedAt === remote.deletedAt &&
    local.type === remote.type &&
    local.visibility === remote.visibility;
  if (!samePayload && s.updated_at > local.updatedAt) {
    recordEventConflict(local, remote);
    result.conflicts += 1;
  }
}

/** Pulls server rows newer than the last watermark; only the signed-in user's own rows. */
async function pullEvents(result: SyncResult): Promise<void> {
  const client = supabase!;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return;
  const lastSynced = kvGet(LAST_SYNCED_KEY);
  let query = client
    .from('events')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: true })
    .limit(PULL_PAGE_SIZE);
  if (lastSynced) query = query.gt('updated_at', lastSynced);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let watermark = lastSynced;
  for (const s of (data ?? []) as ServerEvent[]) {
    applyServerRow(s, result);
    if (!watermark || s.updated_at > watermark) watermark = s.updated_at;
  }
  if (watermark) kvSet(LAST_SYNCED_KEY, watermark);
}

/**
 * Runs one sync pass: pushes the outbox, then pulls newer server rows —
 * for events and for the pregnancy record. No-ops cleanly (empty result)
 * when unconfigured, unsigned-in, or when a step throws mid-pass — local
 * data is never at risk.
 */
export async function syncNow(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
  if (!isConfigured || !supabase) return result;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return result;
    await pushOutbox(result);
    await pushPregnancyOutbox(result);
    await pullEvents(result);
    await pullPregnancies(result);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  return result;
}

/* ================= pregnancy sync (Epic 1) ================= */

/** Raw pregnancy_outbox row as returned by SQLite. */
interface PregnancyOutboxRow {
  id: string;
  pregnancy_id: string;
  op: 'upsert';
  attempts: number;
  created_at: string;
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

/** Server `pregnancies` row shape (date columns arrive as YYYY-MM-DD strings). */
interface ServerPregnancy {
  id: string;
  user_id: string | null;
  due_date: string | null;
  lmp_date: string | null;
  pregnancy_type: Pregnancy['pregnancyType'];
  parity: Pregnancy['parity'];
  status: Pregnancy['status'];
  created_at: string;
  updated_at: string;
}

/** Converts a SQLite row to a typed Pregnancy. */
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

/** Converts a server row to a typed Pregnancy (marked clean). */
function serverToPregnancy(s: ServerPregnancy): Pregnancy {
  return {
    id: s.id,
    userId: s.user_id,
    dueDate: s.due_date,
    lmpDate: s.lmp_date,
    pregnancyType: s.pregnancy_type ?? 'singleton',
    parity: s.parity ?? 'first',
    status: s.status ?? 'active',
    updatedAt: s.updated_at,
    dirty: false,
  };
}

/**
 * Pushes pending pregnancy ops. Onboarding can complete before sign-in, so
 * a row with no user_id waits quietly in the outbox until a session exists
 * — then the id is backfilled from the session before the upsert. RLS is
 * owner-only, so the upsert always carries auth.uid() as user_id.
 */
async function pushPregnancyOutbox(result: SyncResult): Promise<void> {
  const client = supabase!;
  const db = getDb();
  const ops = db.getAllSync<PregnancyOutboxRow>(
    'SELECT * FROM pregnancy_outbox ORDER BY created_at ASC',
  );
  if (ops.length === 0) return;
  const {
    data: { user },
  } = await client.auth.getUser();
  const sessionUserId = user?.id ?? null;
  for (const op of ops) {
    try {
      const row = db.getFirstSync<PregnancyRow>('SELECT * FROM pregnancies WHERE id = ?', op.pregnancy_id);
      if (!row) {
        db.runSync('DELETE FROM pregnancy_outbox WHERE id = ?', op.id);
        continue;
      }
      const userId = row.user_id ?? sessionUserId;
      if (!userId) {
        // Not signed in yet (onboarding before auth): leave the op queued;
        // the next sync after sign-in backfills and pushes. Not an error.
        continue;
      }
      const { error } = await client.from('pregnancies').upsert(
        {
          id: row.id,
          user_id: userId,
          due_date: row.due_date,
          lmp_date: row.lmp_date,
          pregnancy_type: row.pregnancy_type,
          parity: row.parity,
          status: row.status,
          updated_at: row.updated_at,
        },
        { onConflict: 'id' },
      );
      if (error) throw new Error(error.message);
      db.withTransactionSync(() => {
        db.runSync('UPDATE pregnancies SET user_id = ?, dirty = 0 WHERE id = ?', userId, op.pregnancy_id);
        db.runSync('DELETE FROM pregnancy_outbox WHERE id = ?', op.id);
      });
      result.pushed += 1;
    } catch (e) {
      db.runSync('UPDATE pregnancy_outbox SET attempts = attempts + 1 WHERE id = ?', op.id);
      result.errors.push(
        `push pregnancy ${op.pregnancy_id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Records a conflict pair locally; user content is never merged automatically. */
function recordConflict(kind: 'event' | 'pregnancy', id: string, localJson: string, remoteJson: string): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO conflicts (id, kind, local_json, remote_json, detected_at) VALUES (?, ?, ?, ?, ?)',
    id,
    kind,
    localJson,
    remoteJson,
    new Date().toISOString(),
  );
}

/** Applies one pulled server pregnancy row (conflict-aware, like events). */
function applyServerPregnancy(s: ServerPregnancy, result: SyncResult): void {
  const db = getDb();
  const row = db.getFirstSync<PregnancyRow>('SELECT * FROM pregnancies WHERE id = ?', s.id);
  const remote = serverToPregnancy(s);
  if (!row) {
    db.runSync(
      `INSERT OR REPLACE INTO pregnancies
        (id, user_id, due_date, lmp_date, pregnancy_type, parity, status, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      s.id,
      s.user_id,
      s.due_date,
      s.lmp_date,
      remote.pregnancyType,
      remote.parity,
      remote.status,
      s.updated_at,
    );
    result.pulled += 1;
    return;
  }
  const local = rowToPregnancy(row);
  if (!local.dirty) {
    db.runSync(
      `UPDATE pregnancies SET user_id = ?, due_date = ?, lmp_date = ?,
        pregnancy_type = ?, parity = ?, status = ?, updated_at = ?, dirty = 0 WHERE id = ?`,
      s.user_id,
      s.due_date,
      s.lmp_date,
      remote.pregnancyType,
      remote.parity,
      remote.status,
      s.updated_at,
      local.id,
    );
    result.pulled += 1;
    return;
  }
  const samePayload =
    local.dueDate === remote.dueDate &&
    local.lmpDate === remote.lmpDate &&
    local.pregnancyType === remote.pregnancyType &&
    local.parity === remote.parity &&
    local.status === remote.status;
  if (!samePayload && s.updated_at > local.updatedAt) {
    recordConflict('pregnancy', local.id, JSON.stringify(local), JSON.stringify(remote));
    result.conflicts += 1;
  }
}

/** Pulls the signed-in user's pregnancy rows newer than the watermark. */
async function pullPregnancies(result: SyncResult): Promise<void> {
  const client = supabase!;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return;
  const lastSynced = kvGet(LAST_SYNCED_PREGNANCIES_KEY);
  let query = client
    .from('pregnancies')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: true })
    .limit(PULL_PAGE_SIZE);
  if (lastSynced) query = query.gt('updated_at', lastSynced);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let watermark = lastSynced;
  for (const s of (data ?? []) as ServerPregnancy[]) {
    applyServerPregnancy(s, result);
    if (!watermark || s.updated_at > watermark) watermark = s.updated_at;
  }
  if (watermark) kvSet(LAST_SYNCED_PREGNANCIES_KEY, watermark);
}

/** Returns all unresolved sync conflicts (never merged automatically). */
export function getConflicts(): SyncConflict[] {
  const rows = getDb().getAllSync<{
    id: string;
    kind: string;
    local_json: string;
    remote_json: string;
    detected_at: string;
  }>(
    'SELECT id, kind, local_json, remote_json, detected_at FROM conflicts ORDER BY detected_at DESC',
  );
  return rows.map((row) => ({
    id: row.id,
    kind: (row.kind === 'pregnancy' ? 'pregnancy' : 'event') as 'event' | 'pregnancy',
    local: JSON.parse(row.local_json) as LocalEvent | Pregnancy,
    remote: JSON.parse(row.remote_json) as LocalEvent | Pregnancy,
    detectedAt: row.detected_at,
  }));
}

/**
 * Resolves a conflict. 'local' keeps the local edits (re-queues an upsert);
 * 'remote' discards local edits in favor of the server version.
 */
export function resolveConflict(id: string, winner: 'local' | 'remote'): void {
  const db = getDb();
  const row = db.getFirstSync<{ kind: string; local_json: string; remote_json: string }>(
    'SELECT kind, local_json, remote_json FROM conflicts WHERE id = ?',
    id,
  );
  if (!row) return;
  db.withTransactionSync(() => {
    if (row.kind === 'pregnancy') {
      resolvePregnancyConflict(id, winner, row);
    } else {
      resolveEventConflict(id, winner, row);
    }
    db.runSync('DELETE FROM conflicts WHERE id = ?', id);
  });
}

/** Applies the winning side of an event conflict. */
function resolveEventConflict(
  id: string,
  winner: 'local' | 'remote',
  row: { local_json: string; remote_json: string },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (winner === 'local') {
    // Local edits win: refresh the timestamp and re-queue an upsert so the
    // next push overwrites the server row with the local version.
    db.runSync('UPDATE events SET updated_at = ?, dirty = 1 WHERE id = ?', now, id);
    db.runSync(
      `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      Crypto.randomUUID(),
      id,
      now,
    );
  } else {
    const remote = JSON.parse(row.remote_json) as LocalEvent;
    db.runSync(
      `UPDATE events SET user_id = ?, pregnancy_id = ?, type = ?, occurred_at = ?,
        visibility = ?, data = ?, idempotency_key = ?, deleted_at = ?, updated_at = ?, dirty = 0
       WHERE id = ?`,
      remote.userId,
      remote.pregnancyId,
      remote.type,
      remote.occurredAt,
      remote.visibility,
      JSON.stringify(remote.data),
      remote.idempotencyKey,
      remote.deletedAt,
      remote.updatedAt,
      id,
    );
  }
}

/** Applies the winning side of a pregnancy conflict. */
function resolvePregnancyConflict(
  id: string,
  winner: 'local' | 'remote',
  row: { local_json: string; remote_json: string },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (winner === 'local') {
    db.runSync('UPDATE pregnancies SET updated_at = ?, dirty = 1 WHERE id = ?', now, id);
    db.runSync(
      `INSERT INTO pregnancy_outbox (id, pregnancy_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      Crypto.randomUUID(),
      id,
      now,
    );
  } else {
    const remote = JSON.parse(row.remote_json) as Pregnancy;
    db.runSync(
      `UPDATE pregnancies SET user_id = ?, due_date = ?, lmp_date = ?,
        pregnancy_type = ?, parity = ?, status = ?, updated_at = ?, dirty = 0
       WHERE id = ?`,
      remote.userId,
      remote.dueDate,
      remote.lmpDate,
      remote.pregnancyType,
      remote.parity,
      remote.status,
      remote.updatedAt,
      id,
    );
  }
}

/** Returns the ISO timestamp of the last successful pull, or null when never synced. */
export function getLastSyncedAt(): string | null {
  return kvGet(LAST_SYNCED_KEY);
}
