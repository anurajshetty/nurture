/**
 * Web SQLite layer for Nurture (sql.js — SQLite compiled to WASM).
 *
 * Metro picks this file instead of `db.ts` on web (`*.web.ts` platform
 * extension). It exposes the exact same public API — `getDb`, `kvGet`,
 * `kvSet`, `kvDelete`, `clearAllLocalData`, `ensureDbReady` — over the
 * same schema (`./schema`), so every caller in `src/sync` and `src`
 * works unchanged.
 *
 * Differences from native:
 * - The WASM module loads asynchronously, so the root layout awaits
 *   `ensureDbReady()` before rendering anything that touches the DB.
 * - The database persists to localStorage (base64 of the exported SQLite
 *   image) after every write; when storage is unavailable it stays
 *   in-memory for the session.
 * - The sql-wasm.wasm binary is copied into the web export output by the
 *   `export:web` npm script and resolved relative to the page URL, so it
 *   works under the /nurture subpath on GitHub Pages.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import {
  applySchema,
  DB_NAME,
  type SyncDbHandle,
} from './schema';

const STORAGE_KEY = 'nurture.db.v1';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let rawDb: SqlJsDatabase | null = null;
let readyPromise: Promise<void> | null = null;
let adapter: WebDatabase | null = null;

/** Encode bytes for localStorage without blowing the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function loadPersisted(): Uint8Array | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? fromBase64(raw) : undefined;
  } catch {
    return undefined;
  }
}

function persist(): void {
  if (!rawDb) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, toBase64(rawDb.export()));
  } catch {
    // Storage full or unavailable — the in-memory DB still works for
    // this session; nothing the user can act on, so stay quiet.
  }
}

/**
 * Synchronous query handle over sql.js. Mirrors the expo-sqlite sync API
 * surface the app uses (`getFirstSync`, `getAllSync`, `runSync`,
 * `execSync`, `withTransactionSync`).
 */
class WebDatabase implements SyncDbHandle {
  private txDepth = 0;

  getFirstSync<T>(source: string, ...params: unknown[]): T | null {
    const db = this.db();
    const stmt = db.prepare(source);
    try {
      stmt.bind(params as (string | number | Uint8Array | null)[]);
      if (stmt.step()) {
        return stmt.getAsObject() as unknown as T;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  getAllSync<T>(source: string, ...params: unknown[]): T[] {
    const db = this.db();
    const stmt = db.prepare(source);
    const rows: T[] = [];
    try {
      stmt.bind(params as (string | number | Uint8Array | null)[]);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  runSync(source: string, ...params: unknown[]): { changes: number; lastInsertRowId: number } {
    const db = this.db();
    const stmt = db.prepare(source);
    try {
      stmt.bind(params as (string | number | Uint8Array | null)[]);
      stmt.step();
      const changes = db.getRowsModified();
      const idRow = db.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowId =
        idRow.length > 0 && idRow[0].values.length > 0 ? Number(idRow[0].values[0][0]) || 0 : 0;
      return { changes, lastInsertRowId };
    } finally {
      stmt.free();
      if (this.txDepth === 0) persist();
    }
  }

  execSync(source: string): void {
    this.db().exec(source);
    if (this.txDepth === 0) persist();
  }

  withTransactionSync(task: () => void): void {
    const db = this.db();
    const nested = this.txDepth > 0;
    this.txDepth += 1;
    db.exec(nested ? 'SAVEPOINT nurture_tx' : 'BEGIN');
    try {
      task();
      db.exec(nested ? 'RELEASE SAVEPOINT nurture_tx' : 'COMMIT');
    } catch (e) {
      try {
        db.exec(nested ? 'ROLLBACK TO SAVEPOINT nurture_tx' : 'ROLLBACK');
      } catch {
        // Rollback itself failed — rethrow the original error regardless.
      }
      throw e;
    } finally {
      this.txDepth -= 1;
      if (this.txDepth === 0) persist();
    }
  }

  private db(): SqlJsDatabase {
    if (!rawDb) {
      throw new Error('Web database used before ensureDbReady() resolved.');
    }
    return rawDb;
  }
}

/**
 * Loads the SQLite WASM module, restores the persisted database (or starts
 * fresh), and applies the schema. Resolves once — the root layout awaits
 * this before rendering. Never throws; a failed init leaves an in-memory
 * database so the app still boots.
 */
export function ensureDbReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      SQL = await initSqlJs({
        locateFile: (file: string) => new URL(file, window.location.href).toString(),
      });
      rawDb = new SQL.Database(loadPersisted());
    } catch (e) {
      console.warn('[db] web sqlite init failed, using throwaway memory DB', e);
      try {
        SQL = await initSqlJs({
          locateFile: (file: string) => new URL(file, window.location.href).toString(),
        });
        rawDb = new SQL.Database();
      } catch {
        // Truly without storage — getDb() will throw a clear error below.
        return;
      }
    }
    adapter = new WebDatabase();
    applySchema(adapter);
  })();
  return readyPromise;
}

/** Opens (and migrates) the web database; the handle is reused afterwards. */
export function getDb(): SyncDbHandle {
  if (!adapter) {
    throw new Error(
      'Database accessed before it was ready. The root layout must await ensureDbReady() first.',
    );
  }
  return adapter;
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
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already gone — nothing to do.
  }
}

/** Database file name, shared with native for parity (unused on web). */
export { DB_NAME };
