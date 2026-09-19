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
export const SCHEMA_VERSION = 4;

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
