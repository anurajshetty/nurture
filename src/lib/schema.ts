/**
 * Shared SQLite schema for Willow (used by the native expo-sqlite store
 * and the web sql.js store alike).
 *
 * `SyncDbHandle` is the structural subset of expo-sqlite's SQLiteDatabase
 * that the schema setup needs. Both the native handle and the web adapter
 * satisfy it, so the schema lives in exactly one place.
 */

export interface SyncDbHandle {
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
  getAllSync<T>(source: string, ...params: unknown[]): T[];
  runSync(source: string, ...params: unknown[]): { changes: number; lastInsertRowId: number };
  execSync(source: string): void;
  withTransactionSync(task: () => void): void;
}

export const DB_NAME = 'nurture.db';
export const SCHEMA_VERSION = 7;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  pregnancy_id TEXT,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  data TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE NOT NULL,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  -- v6 (Willow, Sept 2026): creation timestamp. The feed's story order
  -- keys off this for EVERY entry — each new report, log, or appointment
  -- lands at the top of the current week's section, never at a subject
  -- date (appointment's scheduled date, report's document date). Set once
  -- at insert, never updated.
  created_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  op TEXT NOT NULL,              -- 'upsert' | 'delete'
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,           -- event or pregnancy id
  kind TEXT NOT NULL DEFAULT 'event',  -- 'event' | 'pregnancy'
  local_json TEXT NOT NULL,
  remote_json TEXT NOT NULL,
  detected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pregnancies (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  due_date TEXT,
  lmp_date TEXT,
  -- PRIVACY PASS (Sept 2026, onboarding): owner_name and dob are new PII
  -- collected during onboarding. They travel the same owner-only RLS path
  -- as the rest of the pregnancy record (never sent to the briefing edge
  -- function — see src/briefing/context.ts NEVER list), but no
  -- privacy-policy/disclosures file exists in this repo yet. Before this
  -- ships to the App Store, add both fields to the privacy disclosures.
  -- The matching remote migration is
  -- supabase/migrations/20260919150000_add_profile_fields_to_pregnancies.sql
  -- (dob is YYYY-MM-DD, same calendar-date convention as due_date.)
  owner_name TEXT,
  dob TEXT,
  pregnancy_type TEXT NOT NULL DEFAULT 'singleton',
  parity TEXT NOT NULL DEFAULT 'first',
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pregnancy_outbox (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  op TEXT NOT NULL,              -- 'upsert'
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  bucket TEXT NOT NULL,              -- 'photos' | 'files'
  local_uri TEXT NOT NULL,
  storage_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, attachment_id)
);
`;

/**
 * One-off random id for migration outbox rows (uuid-shaped, unique enough
 * for a single boot pass; avoids pulling expo-crypto into this shared
 * schema module).
 */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Reads the stored schema version straight from the handle. */
function readSchemaVersion(handle: SyncDbHandle): number {
  try {
    const row = handle.getFirstSync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    return row ? Number.parseInt(row.value, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Slots rows matched by `where` (with `params`) just below the latest
 * legitimately-logged item, preserving their relative order by
 * occurred_at ascending. The anchor is MAX(created_at) over rows whose
 * created_at is not in the future; when nothing qualifies, now is used.
 * Rows are assigned ISO timestamps one second apart strictly under the
 * anchor — a future created_at is NEVER written.
 *
 * Used by the hardened v6 backfill (rows whose occurred_at is scheduled
 * ahead) and the v7 repair (rows poisoned by the original v6 backfill).
 */
function slotPoisonedRows(
  handle: SyncDbHandle,
  where: string,
  now: string,
  ...params: unknown[]
): void {
  const rows = handle.getAllSync<{ id: string }>(
    `SELECT id FROM events WHERE ${where} ORDER BY occurred_at ASC`,
    ...params,
  );
  if (rows.length === 0) return;
  const legit = handle.getFirstSync<{ m: string | null }>(
    'SELECT MAX(created_at) AS m FROM events WHERE created_at <= ?',
    now,
  );
  const parsed = legit?.m ? Date.parse(legit.m) : NaN;
  const anchorMs = Number.isNaN(parsed) ? Date.parse(now) : parsed;
  const n = rows.length;
  for (let i = 0; i < n; i += 1) {
    const ts = new Date(anchorMs - (n - i) * 1000).toISOString();
    handle.runSync('UPDATE events SET created_at = ? WHERE id = ?', ts, rows[i].id);
  }
}

/**
 * Applies pending schema migrations. The base SCHEMA_SQL is idempotent
 * (CREATE TABLE IF NOT EXISTS), so migrations only cover ALTER-style
 * changes for databases created by earlier app versions.
 */
function runMigrations(handle: SyncDbHandle): void {
  const current = readSchemaVersion(handle);
  if (current < 2) {
    // v2: conflicts gained a `kind` column so pregnancy conflicts can share
    // the table with event conflicts (never merged silently, same policy).
    const cols = handle.getAllSync<{ name: string }>('PRAGMA table_info(conflicts)');
    if (!cols.some((c) => c.name === 'kind')) {
      handle.execSync("ALTER TABLE conflicts ADD COLUMN kind TEXT NOT NULL DEFAULT 'event'");
    }
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')");
  }
  if (current < 3) {
    // v3 (Epic 2.3): media_outbox queues photo/file bytes for cloud backup.
    // The CREATE TABLE IF NOT EXISTS in SCHEMA_SQL already ran above, so
    // this only bumps the version marker for pre-2.3 databases.
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')");
  }
  if (current < 4) {
    // v4 (onboarding, Sept 2026): pregnancies gains owner_name (her name)
    // and dob (her birthday, YYYY-MM-DD). Both nullable; existing rows
    // keep working untouched. See the PRIVACY PASS comment on the
    // pregnancies table above before shipping.
    const cols = handle.getAllSync<{ name: string }>('PRAGMA table_info(pregnancies)');
    if (!cols.some((c) => c.name === 'owner_name')) {
      handle.execSync('ALTER TABLE pregnancies ADD COLUMN owner_name TEXT');
    }
    if (!cols.some((c) => c.name === 'dob')) {
      handle.execSync('ALTER TABLE pregnancies ADD COLUMN dob TEXT');
    }
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')");
  }
  if (current < 5) {
    // v5 (Willow ephemeral reports, Sept 2026): report uploads no longer
    // persist bytes anywhere — no attachment, no Storage object, no
    // media-outbox row. Clean up the entries the old flow left behind:
    //  - 'file' / 'photo' entries: tombstoned (the stuck "Backing up…"
    //    cards). Tombstone, not hard delete — the 'delete' outbox op
    //    tells the server and other devices the entry is gone.
    //  - 'report' entries whose summary never completed ('summarizing' /
    //    legacy 'reading' / 'failed' / missing state): tombstoned for the
    //    same reason — their bytes are gone and can never be summarized.
    //  - 'report' entries with a completed ('ready') summary: KEPT, but
    //    stripped to text-only (attachments removed from data) to match
    //    the new feed contract.
    // Queued media-outbox rows for tombstoned events are dropped — there
    // is nothing left to upload.
    const rows = handle.getAllSync<{ id: string; type: string; data: string }>(
      "SELECT id, type, data FROM events WHERE deleted_at IS NULL AND type IN ('file', 'photo', 'report')",
    );
    const now = new Date().toISOString();
    for (const row of rows) {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        data = {};
      }
      const summaryStatus = (data.reportSummary as { status?: unknown } | undefined)?.status;
      if (row.type === 'report' && summaryStatus === 'ready') {
        // Keep the summary; drop the persisted file reference.
        delete data.attachments;
        handle.withTransactionSync(() => {
          handle.runSync('UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?', JSON.stringify(data), now, row.id);
          handle.runSync(
            `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
            randomId(),
            row.id,
            now,
          );
        });
        continue;
      }
      handle.withTransactionSync(() => {
        handle.runSync(
          'UPDATE events SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
          now,
          now,
          row.id,
        );
        handle.runSync(
          `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'delete', 0, ?)`,
          randomId(),
          row.id,
          now,
        );
        handle.runSync('DELETE FROM media_outbox WHERE event_id = ?', row.id);
      });
    }
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '5')");
  }
  if (current < 6) {
    // v6 (Willow feed story order, Sept 2026): events gains created_at,
    // the immutable creation timestamp. EVERY new report, log, or
    // appointment goes to the top of the current week's feed section: the
    // feed sorts and day-groups by creation date, never by subject date
    // (not the appointment's scheduled date, not a report's document
    // date). Set once at insert, never updated. Existing rows backfill to
    // occurred_at — the closest knowable story position, and exactly the
    // order they already render in, so nothing visibly reshuffles on
    // upgrade.
    //
    // Hardened (Sept 2026, Anuraj's live-feed bug): appointments carry the
    // SCHEDULED (often future) occurred_at, so a blind created_at =
    // occurred_at backfill would write FUTURE created_at values and the
    // poisoned appointments would sort above everything logged before that
    // future time. The backfill therefore runs in two steps: past occurred_at
    // copies straight over; rows still NULL (future occurred_at) are slotted
    // just below the latest legitimately-logged item, preserving order. A
    // future created_at is never written.
    const cols = handle.getAllSync<{ name: string }>('PRAGMA table_info(events)');
    if (!cols.some((c) => c.name === 'created_at')) {
      handle.execSync('ALTER TABLE events ADD COLUMN created_at TEXT');
    }
    const now6 = new Date().toISOString();
    handle.runSync(
      'UPDATE events SET created_at = occurred_at WHERE created_at IS NULL AND occurred_at <= ?',
      now6,
    );
    slotPoisonedRows(handle, 'created_at IS NULL', now6);
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')");
  }
  if (current < 7) {
    // v7 (Willow, Sept 2026): repair poisoned created_at from the original
    // v6 backfill (shipped before the hardening above). That backfill wrote
    // created_at = occurred_at, and appointments carry the SCHEDULED
    // (often future) occurred_at — so appointments logged before the
    // migration sort above everything logged before that future time
    // (Anuraj's Scan scheduled 10:30 AM outranked his moment logged 7:32
    // AM). Nothing is legitimately logged in the future, so every row with
    // created_at > now is poisoned: slot them just below the latest
    // legitimately-logged item, preserving relative order by occurred_at.
    // Rows whose poisoned created_at has already passed into the past
    // can't be distinguished — leave them.
    const now7 = new Date().toISOString();
    slotPoisonedRows(handle, 'created_at > ?', now7, now7);
    handle.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '7')");
  }
}

/** Creates the schema idempotently and runs pending migrations. */
export function applySchema(handle: SyncDbHandle): void {
  handle.execSync(SCHEMA_SQL);
  handle.runSync(
    'INSERT OR IGNORE INTO meta (key, value) VALUES (\'schema_version\', ?)',
    String(SCHEMA_VERSION),
  );
  runMigrations(handle);
}
