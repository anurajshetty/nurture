/**
 * Regression test: the null-user_id sync bug (Willow, Sept 2026 — Anuraj
 * found it in live verification).
 *
 * Root cause: entries created before the anonymous identity resolved were
 * stamped `user_id = NULL` locally; `pushOutbox` pushed them as-is; the
 * owner-only RLS policy rejected every push; retries re-pushed the same
 * null id forever — it never self-healed. Production `events` had 0 rows.
 *
 * The fix under test:
 * 1. Push-time healing: `pushOutbox` stamps the live session's user id
 *    onto null/mismatched rows (persisted locally) before upserting.
 * 2. Creation gate: `saveEventAwaitingIdentity` awaits identity resolution
 *    before stamping; identity-unknown rows stay local-only until the
 *    sweep (`sweepIdentityPendingRows`) picks them up.
 * 3. Push failures are counted/recorded (`getSyncDiagnostics`), never
 *    silently swallowed.
 *
 * The fake Supabase simulates the RLS policy: an upsert with a null
 * user_id is REJECTED. Without the fix, the row never lands (test fails);
 * with the fix, healing stamps the session id and the row lands (passes).
 *
 * Run with:
 *   npx tsc tests/sync_identity_healing.test.ts src/sync/engine.ts \
 *     src/sync/store.ts src/auth/identity.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-syncheal-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-syncheal-tests/tests/sync_identity_healing.test.js
 */

// `require` comes from @types/node (same pattern as
// tests/labor_feed.test.ts).
const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

/* ---------------- in-memory fakes ---------------- */

let uuidCtr = 0;

interface FakeEventRow {
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
  created_at: string;
  dirty: number;
}

interface FakeOutboxRow {
  id: string;
  event_id: string;
  op: string;
  attempts: number;
  created_at: string;
}

const fakeEvents = new Map<string, FakeEventRow>();
const fakeOutbox: FakeOutboxRow[] = [];
const fakeKv = new Map<string, string>();
/** Payloads the fake server accepted (RLS passed). */
const serverEvents: Record<string, unknown>[] = [];
/** When true, the next upsert fails even with a valid user_id. */
let failNextUpsert = false;
const SESSION_USER_ID = 'user-abc-123';

const fakeDb = {
  getFirstSync<T>(sql: string, ...params: unknown[]): T | null {
    if (sql.startsWith('SELECT * FROM events WHERE id = ?')) {
      return (fakeEvents.get(params[0] as string) as unknown as T) ?? null;
    }
    if (sql.startsWith('SELECT value FROM kv WHERE key = ?')) {
      const v = fakeKv.get(params[0] as string);
      return (v === undefined ? null : ({ value: v } as unknown)) as T;
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM outbox')) {
      return ({ n: fakeOutbox.length } as unknown) as T;
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM pregnancy_outbox')) {
      return ({ n: 0 } as unknown) as T;
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM events WHERE user_id IS NULL')) {
      let n = 0;
      for (const r of fakeEvents.values()) {
        if (r.user_id === null && r.deleted_at === null) n += 1;
      }
      return ({ n } as unknown) as T;
    }
    throw new Error('fakeDb.getFirstSync: unexpected SQL: ' + sql);
  },
  getAllSync<T>(sql: string, ...params: unknown[]): T[] {
    if (sql.startsWith('SELECT * FROM outbox ORDER BY created_at ASC')) {
      return ([...fakeOutbox] as unknown) as T[];
    }
    if (sql.startsWith('SELECT * FROM pregnancy_outbox ORDER BY created_at ASC')) {
      return ([] as unknown) as T[];
    }
    if (sql.startsWith('SELECT e.id AS id,')) {
      // sweepIdentityPendingRows: null-user_id rows + whether they have an upsert op.
      const rows: { id: string; has_op: number }[] = [];
      for (const r of fakeEvents.values()) {
        if (r.user_id === null && r.deleted_at === null) {
          rows.push({
            id: r.id,
            has_op: fakeOutbox.some((o) => o.event_id === r.id && o.op === 'upsert') ? 1 : 0,
          });
        }
      }
      void params;
      return (rows as unknown) as T[];
    }
    throw new Error('fakeDb.getAllSync: unexpected SQL: ' + sql);
  },
  runSync(sql: string, ...params: unknown[]): { changes: number; lastInsertRowId: number } {
    const done = { changes: 1, lastInsertRowId: 0 };
    if (sql.startsWith('INSERT INTO events')) {
      const [id, user_id, pregnancy_id, type, occurred_at, visibility, data, idempotency_key, updated_at, created_at] =
        params as [string, string | null, string | null, string, string, string, string, string, string, string];
      fakeEvents.set(id, {
        id, user_id, pregnancy_id, type, occurred_at, visibility, data,
        idempotency_key, deleted_at: null, updated_at, created_at, dirty: 1,
      });
      return done;
    }
    if (sql.startsWith('INSERT INTO outbox')) {
      fakeOutbox.push({
        id: params[0] as string, event_id: params[1] as string,
        op: 'upsert', attempts: 0, created_at: params[2] as string,
      });
      return done;
    }
    if (sql.startsWith('UPDATE events SET user_id = ? WHERE id = ?')) {
      const row = fakeEvents.get(params[1] as string);
      if (row) row.user_id = params[0] as string;
      return done;
    }
    if (sql.startsWith('UPDATE events SET user_id = ? WHERE user_id IS NULL')) {
      for (const row of fakeEvents.values()) {
        if (row.user_id === null) row.user_id = params[0] as string;
      }
      return done;
    }
    if (sql.startsWith('UPDATE events SET dirty = 0 WHERE id = ?')) {
      const row = fakeEvents.get(params[0] as string);
      if (row) row.dirty = 0;
      return done;
    }
    if (sql.startsWith('DELETE FROM outbox WHERE id = ?')) {
      const i = fakeOutbox.findIndex((o) => o.id === params[0]);
      if (i >= 0) fakeOutbox.splice(i, 1);
      return done;
    }
    if (sql.startsWith('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?')) {
      const op = fakeOutbox.find((o) => o.id === params[0]);
      if (op) op.attempts += 1;
      return done;
    }
    if (sql.startsWith('INSERT OR REPLACE INTO kv')) {
      fakeKv.set(params[0] as string, params[1] as string);
      return done;
    }
    throw new Error('fakeDb.runSync: unexpected SQL: ' + sql);
  },
  withTransactionSync(task: () => void): void {
    task();
  },
};

function makeQueryBuilder() {
  const q: Record<string, unknown> = {};
  const chain = (..._a: unknown[]) => q;
  q['select'] = chain;
  q['eq'] = chain;
  q['order'] = chain;
  q['limit'] = chain;
  q['gt'] = chain;
  q['then'] = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return q;
}

const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: SESSION_USER_ID } } } }),
    getUser: async () => ({ data: { user: { id: SESSION_USER_ID } } }),
  },
  from: (table: string) => {
    if (table === 'pregnancies') return makeQueryBuilder();
    if (table !== 'events') throw new Error('fakeSupabase.from: unexpected table ' + table);
    const q = makeQueryBuilder();
    q['upsert'] = async (payload: Record<string, unknown>) => {
      if (failNextUpsert) {
        failNextUpsert = false;
        return { error: { message: 'simulated network boom' } };
      }
      // Owner-only RLS simulation: null user_id is rejected, exactly like
      // production did to the real stuck rows.
      if (!payload['user_id']) {
        return { error: { message: 'new row violates row-level security policy for table "events"' } };
      }
      serverEvents.push(payload);
      return { error: null };
    };
    q['update'] = () => ({ eq: async () => ({ error: null }) });
    return q;
  },
};

const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'expo-crypto') {
    return { randomUUID: () => `uuid-${++uuidCtr}` };
  }
  if (request === '../lib/supabase') {
    return { supabase: fakeSupabase, isConfigured: true };
  }
  if (request === '../lib/db') {
    return {
      getDb: () => fakeDb,
      kvGet: (k: string) => (fakeKv.has(k) ? fakeKv.get(k)! : null),
      kvSet: (k: string, v: string) => fakeKv.set(k, v),
      kvDelete: (k: string) => fakeKv.delete(k),
      clearAllLocalData: () => {},
      ensureDbReady: async () => {},
    };
  }
  return origLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../src/sync/store') as typeof import('../src/sync/store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require('../src/sync/engine') as typeof import('../src/sync/engine');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const identity = require('../src/auth/identity') as typeof import('../src/auth/identity');

/* ---------------- test harness ---------------- */

let passed = 0;
let failed = 0;

function check(ok: boolean, name: string): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error('FAIL:', name);
  }
}

function resetAll(): void {
  fakeEvents.clear();
  fakeOutbox.length = 0;
  fakeKv.clear();
  serverEvents.length = 0;
  failNextUpsert = false;
  uuidCtr = 0;
  identity.resetIdentityForTests();
}

async function main(): Promise<void> {
  // --- 1. The regression: entry created before identity resolves, then
  // --- identity resolves, then sync → row lands with the session user_id.
  resetAll();
  const stuck = store.saveEvent({ type: 'note', data: { text: 'pre-identity entry' }, visibility: 'private' });
  check(stuck.userId === null, 'entry created pre-identity is stamped null');
  check(store.getIdentityPendingCount() === 1, 'identity-pending count is 1');
  // Resolve identity WITHOUT the sweep, so the row reaches pushOutbox
  // still null — this is the exact pre-fix stuck shape.
  identity.noteIdentityUserId(SESSION_USER_ID);
  const r1 = await engine.syncNow();
  check(r1.errors.length === 0, 'sync has no errors after healing, got: ' + r1.errors.join('; '));
  check(r1.pushed === 1, 'one row pushed');
  check(r1.healed === 1, 'one row healed');
  check(serverEvents.length === 1, 'server received exactly one row');
  check(
    (serverEvents[0] as Record<string, unknown>)['user_id'] === SESSION_USER_ID,
    'server row carries the session user_id',
  );
  const healedLocal = fakeEvents.get(stuck.id);
  check(healedLocal?.user_id === SESSION_USER_ID, 'local row healed too');
  check(healedLocal?.dirty === 0, 'local row marked clean');
  check(fakeOutbox.length === 0, 'outbox drained');
  check(store.getIdentityPendingCount() === 0, 'identity-pending count back to 0');

  // --- 2. The sweep: local-only rows (created while identity was down)
  // --- are stamped + queued once identity resolves.
  resetAll();
  const localOnly = store.saveEvent({ type: 'note', data: { text: 'offline entry' }, visibility: 'private' });
  // Simulate the gated local-only path: drop its outbox op.
  const ops = fakeDb.getAllSync<FakeOutboxRow>('SELECT * FROM outbox ORDER BY created_at ASC');
  for (const op of ops) fakeDb.runSync('DELETE FROM outbox WHERE id = ?', op.id);
  check(store.getPendingCount() === 0, 'local-only row has no outbox op');
  const swept = store.sweepIdentityPendingRows(SESSION_USER_ID);
  check(swept === 1, 'sweep stamped one row');
  check(store.getPendingCount() === 1, 'sweep queued the upsert');
  const r2 = await engine.syncNow();
  check(r2.errors.length === 0, 'sweep+sync has no errors');
  check(
    (serverEvents[0] as Record<string, unknown>)['user_id'] === SESSION_USER_ID &&
      (serverEvents[0] as Record<string, unknown>)['id'] === localOnly.id,
    'swept row landed with the session user_id',
  );

  // --- 3. The creation gate: identity known → stamped immediately, queued.
  resetAll();
  identity.noteIdentityUserId(SESSION_USER_ID);
  const gated = await store.saveEventAwaitingIdentity({
    type: 'note', data: { text: 'gated entry' }, visibility: 'private',
  });
  check(gated.userId === SESSION_USER_ID, 'gated entry stamped with the resolved identity');
  check(store.getPendingCount() === 1, 'gated entry queued for sync');
  const r3 = await engine.syncNow();
  check(r3.healed === 0, 'no healing needed when stamped at creation');
  check(r3.pushed === 1 && r3.errors.length === 0, 'gated entry pushed cleanly');

  // --- 4. Failures are counted, never swallowed.
  resetAll();
  identity.noteIdentityUserId(SESSION_USER_ID);
  store.saveEvent({ type: 'note', data: { text: 'flaky' }, visibility: 'private' });
  failNextUpsert = true;
  const r4 = await engine.syncNow();
  check(r4.errors.length === 1, 'failed push surfaces an error');
  const diag = engine.getSyncDiagnostics();
  check(diag.pushFailuresTotal === 1, 'push failure counter bumped');
  check((diag.lastPushError ?? '').includes('simulated network boom'), 'last push error recorded');
  check(diag.lastPushErrorAt !== null, 'last push error timestamp recorded');
  check(diag.pendingOutbox === 1, 'diagnostics report the still-pending op');
  const r5 = await engine.syncNow();
  check(r5.pushed === 1 && r5.errors.length === 0, 'retry after failure succeeds');
  const diag2 = engine.getSyncDiagnostics();
  check(diag2.pushFailuresTotal === 1, 'counter is cumulative (not reset by success)');
  check(diag2.pendingOutbox === 0, 'outbox drained after retry');

  // --- 5. Identity cache primitives.
  resetAll();
  check(identity.getIdentityUserId() === null, 'identity starts null');
  check(identity.isIdentitySettled() === false, 'identity starts unsettled');
  const pendingWait = identity.awaitIdentityUserId(50);
  identity.noteIdentityUserId('user-x');
  check((await pendingWait) === 'user-x', 'awaitIdentityUserId resolves on note');
  check(identity.isIdentitySettled() === true, 'identity settled after note');
  check((await identity.awaitIdentityUserId(10)) === 'user-x', 'await resolves immediately when settled');
  const timedOut = await identity.awaitIdentityUserId(20).then((v) => v);
  check(timedOut === 'user-x', 'settled await ignores the timeout');
  identity.resetIdentityForTests();
  const timeoutNull = await identity.awaitIdentityUserId(20);
  check(timeoutNull === null, 'unresolved await times out with null');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
