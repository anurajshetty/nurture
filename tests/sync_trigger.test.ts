/**
 * Regression test: the sync-trigger gap (Willow, Sept 2026 — Anuraj
 * found it in live verification).
 *
 * Root cause: nothing triggered a sync after most saves. `syncNow()` ran
 * only from dead code (`src/composer/Composer.tsx`, not rendered) and
 * onboarding-complete — NewLogForm, JournalSheet, kick sessions,
 * appointment sheets, activities, AI summaries, Shared-toggle flips and
 * deletes never pushed. There was no interval, foreground, or focus sync.
 * Entries sat in the local outbox indefinitely; production `events` had
 * 0 rows across all of Anuraj's tests.
 *
 * The fix under test:
 * 1. Every entry-mutating store function (writeEventRow, deleteEvent,
 *    hardDeleteEvent, updateEventVisibility, setEventAttachments) calls
 *    `requestSyncAfterSave()` after the local write.
 * 2. `requestSyncAfterSave()` debounces (~1.5s trailing edge): rapid
 *    successive saves coalesce into ONE push — no network storm per save.
 * 3. It is silent and non-blocking: a throwing runner never breaks a
 *    save; with no runner registered the save just queues quietly.
 * 4. The engine registers the real runner at module load
 *    (`registerSyncRunner(() => syncNow())`) — here a fake runner stands
 *    in and "drains" the outbox the way a push would.
 *
 * These tests FAIL without the fix: revert the `requestSyncAfterSave()`
 * calls in `src/sync/store.ts` and the fake runner is never invoked, so
 * the outbox never drains.
 *
 * Run with:
 *   npx tsc tests/sync_trigger.test.ts src/sync/store.ts src/sync/syncTrigger.ts \
 *     src/lib/types.ts \
 *     --ignoreConfig --outDir /tmp/nurture-synctrig-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop \
 *   && node /tmp/nurture-synctrig-tests/tests/sync_trigger.test.js
 */

const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

/* ---------------- in-memory fakes ---------------- */

let uuidCtr = 0;

interface FakeEventRow {
  id: string;
  user_id: string | null;
  visibility: string;
  data: string;
  deleted_at: string | null;
}

interface FakeOutboxRow {
  id: string;
  event_id: string;
  op: 'upsert' | 'delete';
}

const fakeEvents = new Map<string, FakeEventRow>();
const fakeOutbox: FakeOutboxRow[] = [];

const SESSION_USER_ID = 'user-abc-123';

const fakeDb = {
  getFirstSync<T>(sql: string, ...params: unknown[]): T | null {
    if (sql.startsWith('SELECT data FROM events WHERE id = ?')) {
      const row = fakeEvents.get(params[0] as string);
      return ((row ? { data: row.data } : null) as unknown) as T;
    }
    throw new Error('fakeDb.getFirstSync: unexpected SQL: ' + sql);
  },
  getAllSync<T>(): T[] {
    throw new Error('fakeDb.getAllSync: unexpected call');
  },
  runSync(sql: string, ...params: unknown[]): { changes: number; lastInsertRowId: number } {
    const done = { changes: 1, lastInsertRowId: 0 };
    if (sql.startsWith('INSERT INTO events')) {
      const [id, user_id] = params as [string, string | null];
      fakeEvents.set(id, { id, user_id, visibility: 'private', data: '{}', deleted_at: null });
      return done;
    }
    if (sql.startsWith('INSERT INTO outbox')) {
      const op: 'upsert' | 'delete' = sql.includes(`'delete'`) ? 'delete' : 'upsert';
      fakeOutbox.push({ id: params[0] as string, event_id: params[1] as string, op });
      return done;
    }
    if (sql.startsWith('UPDATE events SET visibility')) {
      const row = fakeEvents.get(params[2] as string);
      if (row) row.visibility = params[0] as string;
      return done;
    }
    if (sql.startsWith('UPDATE events SET deleted_at')) {
      const row = fakeEvents.get(params[2] as string);
      if (row) row.deleted_at = params[0] as string;
      return done;
    }
    if (sql.startsWith('UPDATE events SET data')) {
      const row = fakeEvents.get(params[2] as string);
      if (row) row.data = params[0] as string;
      return done;
    }
    if (sql.startsWith('DELETE FROM outbox WHERE event_id = ?')) {
      for (let i = fakeOutbox.length - 1; i >= 0; i--) {
        if (fakeOutbox[i].event_id === params[0]) fakeOutbox.splice(i, 1);
      }
      return done;
    }
    if (sql.startsWith('DELETE FROM events WHERE id = ?')) {
      fakeEvents.delete(params[0] as string);
      return done;
    }
    throw new Error('fakeDb.runSync: unexpected SQL: ' + sql);
  },
  withTransactionSync(task: () => void): void {
    task();
  },
};

const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'expo-crypto') {
    return { randomUUID: () => `uuid-${++uuidCtr}` };
  }
  if (request === '../auth/identity') {
    return {
      awaitIdentityUserId: async () => SESSION_USER_ID,
      getIdentityUserId: () => SESSION_USER_ID,
      noteIdentityUserId: () => {},
    };
  }
  if (request === '../lib/db') {
    return {
      getDb: () => fakeDb,
      kvGet: () => null,
      kvSet: () => {},
      kvDelete: () => {},
      clearAllLocalData: () => {},
      ensureDbReady: async () => {},
    };
  }
  return origLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('../src/sync/store') as typeof import('../src/sync/store');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const trigger = require('../src/sync/syncTrigger') as typeof import('../src/sync/syncTrigger');

/* ---------------- harness ---------------- */

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL ' + label);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fake engine: counts invocations and drains the outbox like a push. */
let runnerCalls = 0;
async function fakeRunner(): Promise<void> {
  runnerCalls++;
  fakeOutbox.length = 0;
}

function resetAll(): void {
  fakeEvents.clear();
  fakeOutbox.length = 0;
  runnerCalls = 0;
  uuidCtr = 0;
  trigger.resetSyncTriggerForTests();
  trigger.registerSyncRunner(fakeRunner);
  trigger.setSyncTriggerDebounceMs(15);
}

async function main(): Promise<void> {
  // --- 1. A NewLogForm-style save triggers a push that drains the outbox.
  // (NewLogForm calls saveEventAwaitingIdentity; the write choke point is
  // writeEventRow — the same function every creation path funnels through.)
  resetAll();
  const ev = await store.saveEventAwaitingIdentity({
    userId: SESSION_USER_ID,
    type: 'note',
    data: { text: 'first log' },
  });
  check(fakeOutbox.length === 1, 'save queues one outbox op immediately');
  check(runnerCalls === 0, 'debounce: no push fires synchronously with the save');
  await sleep(80);
  check(runnerCalls >= 1, 'a push was attempted without any manual refresh');
  check(fakeOutbox.length === 0, 'the push drained the outbox');

  // --- 2. Debounce: rapid successive saves coalesce into one push.
  resetAll();
  await store.saveEventAwaitingIdentity({ userId: SESSION_USER_ID, type: 'note', data: { text: 'a' } });
  await store.saveEventAwaitingIdentity({ userId: SESSION_USER_ID, type: 'note', data: { text: 'b' } });
  await store.saveEventAwaitingIdentity({ userId: SESSION_USER_ID, type: 'note', data: { text: 'c' } });
  check(fakeOutbox.length === 3, 'three saves queue three ops');
  await sleep(100);
  check(runnerCalls === 1, 'three rapid saves produced exactly one push (trailing edge)');
  check(fakeOutbox.length === 0, 'one push drained all three ops');

  // --- 3. Deletes trigger a push (tombstone must reach the server).
  resetAll();
  const doomed = await store.saveEventAwaitingIdentity({
    userId: SESSION_USER_ID,
    type: 'note',
    data: { text: 'delete me' },
  });
  await sleep(80); // let the save's push drain first
  check(fakeOutbox.length === 0, 'save push drained before the delete');
  store.deleteEvent(doomed.id);
  check(fakeOutbox.length === 1 && fakeOutbox[0].op === 'delete', 'delete queues a tombstone op');
  const callsBeforeDeletePush = runnerCalls;
  await sleep(80);
  check(runnerCalls === callsBeforeDeletePush + 1, 'delete triggered its own push');
  check(fakeOutbox.length === 0, 'tombstone op pushed');

  // --- 4. Shared-toggle flips trigger a push.
  resetAll();
  const shared = await store.saveEventAwaitingIdentity({
    userId: SESSION_USER_ID,
    type: 'note',
    data: { text: 'share me' },
  });
  await sleep(80);
  store.updateEventVisibility(shared.id, 'shared');
  check(fakeOutbox.length === 1 && fakeOutbox[0].op === 'upsert', 'visibility flip queues an upsert');
  const callsBeforeFlipPush = runnerCalls;
  await sleep(80);
  check(runnerCalls === callsBeforeFlipPush + 1, 'visibility flip triggered a push');
  check(fakeOutbox.length === 0, 'visibility upsert pushed');

  // --- 5. No runner registered: the save never crashes, just queues.
  resetAll();
  trigger.resetSyncTriggerForTests(); // drops the runner
  store.saveEvent({ userId: SESSION_USER_ID, type: 'note', data: { text: 'quiet' } });
  check(fakeOutbox.length === 1, 'save queues even with no runner registered');
  await sleep(80);
  check(runnerCalls === 0, 'no runner registered: no push attempted, no crash');
  check(fakeOutbox.length === 1, 'no runner registered: op stays queued');

  // --- 6. A throwing runner never breaks the save.
  resetAll();
  trigger.resetSyncTriggerForTests();
  trigger.registerSyncRunner(async () => {
    throw new Error('network down');
  });
  trigger.setSyncTriggerDebounceMs(15);
  store.saveEvent({ userId: SESSION_USER_ID, type: 'note', data: { text: 'boom-proof' } });
  check(fakeOutbox.length === 1, 'save queued despite a failing runner');
  await sleep(80);
  check(fakeOutbox.length === 1, 'failing push leaves the op queued for the next pass');
  // (If the throw had propagated, the process would have crashed here.)

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
