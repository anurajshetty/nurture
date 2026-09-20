/**
 * created_at repair tests (Willow, Sept 2026 — Anuraj caught it live).
 *
 * The v6 migration added events.created_at (the feed's immutable story
 * order) and backfilled `created_at = occurred_at`. Appointments carry the
 * SCHEDULED (often future) occurred_at, so appointments logged before the
 * migration got FUTURE created_at values and sorted above everything
 * logged before that future time (a Scan scheduled 10:30 AM outranked a
 * moment logged 7:32 AM).
 *
 * Two fixes, both tested here against REAL SQLite (sql.js), not stubs:
 *  1. Hardened v6 backfill: two steps — past occurred_at copies straight
 *     over; rows still NULL (future occurred_at) slot just below the
 *     latest legitimately-logged item. Never writes a future created_at.
 *  2. v7 repair migration: every row with created_at > now is poisoned
 *     (nothing is legitimately logged in the future); slots them just
 *     below the latest legitimately-logged item, preserving relative
 *     order by occurred_at ascending. Rows whose poisoned created_at has
 *     already passed into the past are left alone.
 *
 * Run with:
 *   npx tsc tests/created_at_repair.test.ts src/lib/schema.ts \
 *     --outDir /tmp/nurture-createdat-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-createdat-tests/tests/created_at_repair.test.js
 * (cwd must be the repo root so node_modules/sql.js resolves).
 */

import { applySchema, SCHEMA_VERSION, type SyncDbHandle } from '../src/lib/schema';

declare const require: any;
declare const process: { cwd(): string; exit(code: number): void };

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

/** Minimal sql.js adapter implementing SyncDbHandle (no window/localStorage). */
function makeHandle(db: any): SyncDbHandle {
  return {
    getFirstSync<T>(source: string, ...params: unknown[]): T | null {
      const stmt = db.prepare(source);
      try {
        stmt.bind(params as any[]);
        return stmt.step() ? (stmt.getAsObject() as unknown as T) : null;
      } finally {
        stmt.free();
      }
    },
    getAllSync<T>(source: string, ...params: unknown[]): T[] {
      const stmt = db.prepare(source);
      const rows: T[] = [];
      try {
        stmt.bind(params as any[]);
        while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
      } finally {
        stmt.free();
      }
      return rows;
    },
    runSync(source: string, ...params: unknown[]): { changes: number; lastInsertRowId: number } {
      const stmt = db.prepare(source);
      try {
        stmt.bind(params as any[]);
        stmt.step();
        return { changes: db.getRowsModified(), lastInsertRowId: 0 };
      } finally {
        stmt.free();
      }
    },
    execSync(source: string): void {
      db.exec(source);
    },
    withTransactionSync(task: () => void): void {
      task();
    },
  };
}

const META_SQL = 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);';
const EVENTS_V5_SQL = `CREATE TABLE events (
  id TEXT PRIMARY KEY, user_id TEXT, pregnancy_id TEXT, type TEXT NOT NULL,
  occurred_at TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private',
  data TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT UNIQUE NOT NULL,
  deleted_at TEXT, updated_at TEXT NOT NULL, dirty INTEGER NOT NULL DEFAULT 1);`;
const EVENTS_V6_SQL = `CREATE TABLE events (
  id TEXT PRIMARY KEY, user_id TEXT, pregnancy_id TEXT, type TEXT NOT NULL,
  occurred_at TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private',
  data TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT UNIQUE NOT NULL,
  deleted_at TEXT, updated_at TEXT NOT NULL, created_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1);`;

function insertEvent(
  db: any,
  id: string,
  type: string,
  occurredAt: string,
  createdAt: string | null,
  hasCreatedAt: boolean,
): void {
  const cols = hasCreatedAt
    ? 'id, type, occurred_at, idempotency_key, updated_at, created_at'
    : 'id, type, occurred_at, idempotency_key, updated_at';
  const vals = hasCreatedAt ? [id, type, occurredAt, id + '-k', occurredAt, createdAt] : [id, type, occurredAt, id + '-k', occurredAt];
  const stmt = db.prepare(`INSERT INTO events (${cols}) VALUES (${vals.map(() => '?').join(',')})`);
  stmt.bind(vals);
  stmt.step();
  stmt.free();
}

function createdAtOf(db: any, id: string): string | null {
  const stmt = db.prepare('SELECT created_at FROM events WHERE id = ?');
  stmt.bind([id]);
  const v = stmt.step() ? (stmt.getAsObject() as any).created_at : null;
  stmt.free();
  return (v as string) ?? null;
}

/** The feed's story order — what Anuraj actually sees. */
function feedOrder(db: any): string[] {
  const stmt = db.prepare(
    'SELECT id FROM events WHERE deleted_at IS NULL ORDER BY COALESCE(created_at, occurred_at) DESC',
  );
  const ids: string[] = [];
  while (stmt.step()) ids.push((stmt.getAsObject() as any).id as string);
  stmt.free();
  return ids;
}

function columnNames(db: any, table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const names: string[] = [];
  while (stmt.step()) names.push((stmt.getAsObject() as any).name as string);
  stmt.free();
  return names;
}

async function main(): Promise<void> {
  // Load sql.js from the repo's node_modules (the emitted test lives in
  // /tmp, so resolve from the repo root explicitly).
  const { createRequire } = require('module');
  const repoRequire = createRequire(process.cwd() + '/package.json');
  const sqljs = repoRequire('sql.js');
  const initSqlJs = (sqljs.default ?? sqljs) as (cfg?: any) => Promise<any>;
  const SQL = await initSqlJs({
    locateFile: (f: string) => process.cwd() + '/node_modules/sql.js/dist/' + f,
  });

  const H = 3600_000;
  const NOW = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  // 2-minute tolerance for "never in the future": the migration's own
  // `now` is a hair after the test's NOW.
  const FUTURE_LIMIT = iso(NOW + 120_000);

  /* ---------------------------------------------------------------- */
  /* 1. Hardened v6 backfill: legacy v5 DB (no created_at column)       */
  /* ---------------------------------------------------------------- */
  {
    const db = new SQL.Database();
    const h = makeHandle(db);
    h.execSync(META_SQL + EVENTS_V5_SQL);
    h.runSync("INSERT INTO meta (key, value) VALUES ('schema_version', '5')");
    insertEvent(db, 'log1', 'log', iso(NOW - 3 * H), null, false);
    insertEvent(db, 'appt1', 'appointment', iso(NOW + 2 * H), null, false);
    insertEvent(db, 'log2', 'log', iso(NOW - 1 * H), null, false);

    applySchema(h);

    ok(columnNames(db, 'events').includes('created_at'), 'v6: migration adds events.created_at');
    const m = h.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    ok(m?.value === String(SCHEMA_VERSION), `v6: legacy v5 db walks to version ${SCHEMA_VERSION}`);
    ok(createdAtOf(db, 'log1') === iso(NOW - 3 * H), 'v6: past occurred_at backfills straight over (log1)');
    ok(createdAtOf(db, 'log2') === iso(NOW - 1 * H), 'v6: past occurred_at backfills straight over (log2)');
    const apptCreated = createdAtOf(db, 'appt1');
    ok(apptCreated !== null && apptCreated <= FUTURE_LIMIT, 'v6: backfill never writes a future created_at');
    ok(apptCreated !== null && apptCreated < iso(NOW + 2 * H), 'v6: future-occurred_at row is NOT a blind copy');
    ok(
      apptCreated !== null && apptCreated <= (createdAtOf(db, 'log2') as string),
      'v6: future-occurred_at row slots below the latest legit item',
    );
    const order = feedOrder(db);
    ok(
      order.indexOf('log2') < order.indexOf('appt1'),
      `v6: feed puts the moment above the future appointment (order=${order.join(',')})`,
    );
    db.close();
  }

  /* ---------------------------------------------------------------- */
  /* 2. v7 repair: v6 DB poisoned by the ORIGINAL blind backfill        */
  /* ---------------------------------------------------------------- */
  {
    const db = new SQL.Database();
    const h = makeHandle(db);
    h.execSync(META_SQL + EVENTS_V6_SQL);
    h.runSync("INSERT INTO meta (key, value) VALUES ('schema_version', '6')");
    // Old blind backfill: created_at = occurred_at, future included.
    insertEvent(db, 'legit1', 'log', iso(NOW - 5 * H), iso(NOW - 5 * H), true);
    insertEvent(db, 'poisonB', 'appointment', iso(NOW + 2 * H), iso(NOW + 2 * H), true);
    insertEvent(db, 'poisonA', 'appointment', iso(NOW + 6 * H), iso(NOW + 6 * H), true);
    // Old poison that has already passed into the past: indistinguishable.
    insertEvent(db, 'pastPoison', 'log', iso(NOW - 8 * H), iso(NOW - 8 * H), true);
    insertEvent(db, 'legit2', 'log', iso(NOW - 1 * H), iso(NOW - 1 * H), true);

    applySchema(h);

    const m = h.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    ok(m?.value === String(SCHEMA_VERSION), `v7: v6 db walks to version ${SCHEMA_VERSION}`);
    ok(createdAtOf(db, 'legit1') === iso(NOW - 5 * H), 'v7: legit rows are untouched (legit1)');
    ok(createdAtOf(db, 'legit2') === iso(NOW - 1 * H), 'v7: legit rows are untouched (legit2)');
    ok(createdAtOf(db, 'pastPoison') === iso(NOW - 8 * H), 'v7: past-poisoned row is left alone');
    const aCreated = createdAtOf(db, 'poisonA');
    const bCreated = createdAtOf(db, 'poisonB');
    ok(aCreated !== null && bCreated !== null, 'v7: poisoned rows keep a created_at');
    ok(
      aCreated !== null && aCreated <= FUTURE_LIMIT && bCreated !== null && bCreated <= FUTURE_LIMIT,
      'v7: no future created_at anywhere after repair',
    );
    ok(
      aCreated !== null && bCreated !== null && aCreated <= iso(NOW - 1 * H) && bCreated <= iso(NOW - 1 * H),
      'v7: poisoned rows slot below the latest legitimately-logged item',
    );
    ok(
      aCreated !== null && bCreated !== null && bCreated < aCreated,
      'v7: relative order preserved (earlier-scheduled appointment slots earlier)',
    );
    const order = feedOrder(db);
    ok(
      order.indexOf('legit2') < order.indexOf('poisonA') &&
        order.indexOf('legit2') < order.indexOf('poisonB'),
      `v7: feed puts the 7:32 AM moment above the poisoned appointments (order=${order.join(',')})`,
    );
    db.close();
  }

  /* ---------------------------------------------------------------- */
  /* 3. v7 repair with NO legit rows (anchor falls back to now)         */
  /* ---------------------------------------------------------------- */
  {
    const db = new SQL.Database();
    const h = makeHandle(db);
    h.execSync(META_SQL + EVENTS_V6_SQL);
    h.runSync("INSERT INTO meta (key, value) VALUES ('schema_version', '6')");
    insertEvent(db, 'p1', 'appointment', iso(NOW + 1 * H), iso(NOW + 1 * H), true);
    insertEvent(db, 'p2', 'appointment', iso(NOW + 3 * H), iso(NOW + 3 * H), true);

    applySchema(h);

    const c1 = createdAtOf(db, 'p1');
    const c2 = createdAtOf(db, 'p2');
    ok(c1 !== null && c1 <= FUTURE_LIMIT && c2 !== null && c2 <= FUTURE_LIMIT, 'v7-nolegit: nothing future after repair');
    ok(c1 !== null && c2 !== null && c1 < c2, 'v7-nolegit: relative order preserved');
    db.close();
  }

  /* ---------------------------------------------------------------- */
  /* 4. Fresh database: no migrations, version lands on SCHEMA_VERSION  */
  /* ---------------------------------------------------------------- */
  {
    const db = new SQL.Database();
    const h = makeHandle(db);
    applySchema(h);
    const m = h.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    ok(m?.value === String(SCHEMA_VERSION), `fresh: version is ${SCHEMA_VERSION}`);
    ok(columnNames(db, 'events').includes('created_at'), 'fresh: events has created_at');
    // Idempotent: a second run changes nothing.
    applySchema(h);
    const m2 = h.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    ok(m2?.value === String(SCHEMA_VERSION), 'fresh: migration is idempotent');
    db.close();
  }

  console.log(`\n=== created_at_repair: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('created_at_repair crashed:', e);
  process.exit(1);
});
