/**
 * Local SQLite layer (expo-sqlite, synchronous API) for Nurture.
 *
 * Owns the offline-first stores: events, the sync outbox, unresolved
 * conflicts, pregnancies, and a generic key/value table (prefs, sync
 * watermarks). Schema is created idempotently on first open (see
 * ./schema.ts, shared with the web store).
 *
 * This module never touches the network and never throws on import; the
 * database is opened lazily on first use.
 */

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { applySchema, DB_NAME } from './schema';

let db: SQLiteDatabase | null = null;

/** Opens (and migrates) the local database; the handle is reused afterwards. */
export function getDb(): SQLiteDatabase {
  if (db) return db;
  const handle = openDatabaseSync(DB_NAME);
  applySchema(handle);
  db = handle;
  return db;
}

/**
 * Resolves when the database is ready for synchronous use. On native the
 * open is synchronous, so this just warms the handle. (The web store's
 * counterpart loads the WASM module asynchronously.)
 */
export function ensureDbReady(): Promise<void> {
  getDb();
  return Promise.resolve();
}

/** Reads a value from the local key/value store, or null when absent. */
export function kvGet(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? row.value : null;
}

/** Writes a value to the local key/value store. */
export function kvSet(key: string, value: string): void {
  getDb().runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
}

/** Removes a key from the local key/value store. */
export function kvDelete(key: string): void {
  getDb().runSync('DELETE FROM kv WHERE key = ?', key);
}

/**
 * Irreversibly wipes every local table (events, outbox, pregnancy_outbox,
 * conflicts, pregnancies, kv). Used by account deletion; sign-out must NOT
 * call this.
 */
export function clearAllLocalData(): void {
  const handle = getDb();
  handle.withTransactionSync(() => {
    handle.execSync(
      'DELETE FROM conflicts; DELETE FROM outbox; DELETE FROM pregnancy_outbox; DELETE FROM events; DELETE FROM pregnancies; DELETE FROM kv;',
    );
  });
}
