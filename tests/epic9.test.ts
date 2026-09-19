/**
 * Epic 9 unit tests — changed-outcome mode.
 *
 * Covers (all pure logic, plain node — no expo-sqlite, no react-native):
 *  1. stop transition — status → 'stopped', outbox upsert queued, aftermath
 *     flag recorded, idempotent on repeat
 *  2. stopReminderPatch — reminders/updates halted
 *  3. isAfterwards — contract C3 predicate (active wins; stopped / flag)
 *  4. data decisions — record/get round-trip, merge, decide-later default
 *  5. expand-to-choose state machine — toggle/choose semantics
 *  6. afterwards content guard — zero developmental content in every
 *     afterwards string + gentle-read placeholders
 *  7. gentle delete guard — explicit confirmation required; guard copy
 *
 * Run:
 *   npx tsc --ignoreConfig tests/epic9.test.ts src/support/aftermath.ts \
 *     src/support/gentleReads.ts src/support/afterwardsCopy.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-epic9-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop \
 *     && node /tmp/nurture-epic9-tests/tests/epic9.test.js
 *
 * (partnerLink.ts is intentionally NOT compiled here — it imports Epic 7's
 * module, which lands at merge time; its behavior is covered by the
 * interactive browser test instead.)
 */

import {
  AFTERMATH_KV,
  chooseDataRowOption,
  confirmDeleteEverything,
  countMoments,
  countSharedMoments,
  getDataDecisions,
  isAfterwards,
  recordDataDecision,
  stopPregnancyTracking,
  stopReminderPatch,
  toggleDataRow,
  type DbLike,
  type KvLike,
} from '../src/support/aftermath';
import { GENTLE_READS, GENTLE_READS_INTRO } from '../src/support/gentleReads';
import {
  ALL_AFTERWARDS_COPY,
  DELETE_GUARD_CONFIRM,
  DELETE_GUARD_DELETED_TOAST,
  DELETE_GUARD_FINE,
  DELETE_GUARD_KEEP,
  DELETE_GUARD_LEDE,
  DELETE_GUARD_TITLE,
} from '../src/support/afterwardsCopy';

/* process.exit without @types/node — same pattern as the other test suites. */
declare const process: { exit(code: number): void };

/* ── tiny in-memory fakes ── */

interface FakePregnancy {
  id: string;
  status: 'active' | 'stopped';
}

function makeDb(pregnancies: FakePregnancy[] = [], shared = 0, total = 0) {
  const outbox: Array<{ pregnancy_id: string; op: string }> = [];
  const db: DbLike = {
    runSync(sql: string, ...params: unknown[]) {
      if (sql.startsWith('UPDATE pregnancies')) {
        for (const p of pregnancies) if (p.status === 'active') p.status = 'stopped';
        return;
      }
      if (sql.startsWith('INSERT INTO pregnancy_outbox')) {
        outbox.push({ pregnancy_id: params[1] as string, op: 'upsert' });
        return;
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    getAllSync<T>(sql: string): T[] {
      if (sql.includes("WHERE status = 'active'")) {
        return pregnancies.filter((p) => p.status === 'active').map((p) => ({ id: p.id }) as T);
      }
      if (sql === 'SELECT status FROM pregnancies') {
        return pregnancies.map((p) => ({ status: p.status }) as T);
      }
      if (sql.includes("visibility = 'shared'")) return [{ n: shared }] as T[];
      if (sql.includes('COUNT(*)')) return [{ n: total }] as T[];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { db, outbox, pregnancies };
}

function makeKv(initial: Record<string, string> = {}): KvLike {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => (map.has(k) ? map.get(k)! : null),
    set: (k, v) => {
      map.set(k, v);
    },
  };
}

/* ── minimal test runner ── */

let passed = 0;
let failed = 0;
function check(cond: boolean, name: string, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ── 1. stop transition ── */

console.log('stop transition');
{
  const { db, outbox, pregnancies } = makeDb([{ id: 'p1', status: 'active' }]);
  const kv = makeKv();
  const stopped = stopPregnancyTracking({
    db,
    kv,
    uuid: () => 'uuid-1',
    now: () => '2026-09-18T00:00:00.000Z',
  });
  check(
    JSON.stringify(stopped) === JSON.stringify(['p1']),
    'returns the stopped pregnancy ids',
  );
  check(pregnancies[0].status === 'stopped', "status → 'stopped'");
  check(
    outbox.length === 1 && outbox[0].pregnancy_id === 'p1' && outbox[0].op === 'upsert',
    'pregnancy upsert queued for sync',
  );
  const flag = kv.get(AFTERMATH_KV);
  check(flag !== null && JSON.parse(flag).stoppedAt === '2026-09-18T00:00:00.000Z',
    'aftermath flag recorded');
  // Idempotent: stopping again stops nothing new.
  const again = stopPregnancyTracking({ db, kv, uuid: () => 'uuid-2', now: () => '2026-09-18T01:00:00.000Z' });
  check(again.length === 0 && outbox.length === 1, 'second stop is a no-op');
}
{
  // No pregnancy at all (e.g. after full deletion) — still records the flag, never throws.
  const { db, outbox } = makeDb([]);
  const kv = makeKv();
  const stopped = stopPregnancyTracking({ db, kv, uuid: () => 'u', now: () => '2026-09-18T00:00:00.000Z' });
  check(stopped.length === 0 && outbox.length === 0, 'no-op with no pregnancies');
  check(kv.get(AFTERMATH_KV) !== null, 'flag still recorded');
}

/* ── 2. reminders/updates halted ── */

console.log('stopReminderPatch');
{
  const patch = stopReminderPatch('2026-09-18T00:00:00.000Z');
  check(patch.endOfDayEnabled === false, 'end-of-day nudge off');
  check(patch.appointmentReminders === false, 'appointment reminders off');
  check(patch.globalPauseUntil === '2026-09-18T00:00:00.000Z', 'global pause set');
}

/* ── 3. isAfterwards (contract C3) ── */

console.log('isAfterwards');
{
  check(isAfterwards({ db: makeDb([{ id: 'p', status: 'active' }]).db, kv: makeKv() }) === false,
    'active pregnancy → not afterwards');
  check(isAfterwards({ db: makeDb([{ id: 'p', status: 'stopped' }]).db, kv: makeKv() }) === true,
    'stopped pregnancy → afterwards');
  check(
    isAfterwards({
      db: makeDb([
        { id: 'a', status: 'stopped' },
        { id: 'b', status: 'active' },
      ]).db,
      kv: makeKv(),
    }) === false,
    'active wins over stopped (future return supersedes)',
  );
  const kv = makeKv({ [AFTERMATH_KV]: JSON.stringify({ stoppedAt: '2026-09-18T00:00:00.000Z', decisions: {} }) });
  check(isAfterwards({ db: makeDb([]).db, kv }) === true,
    'aftermath flag alone (post-deletion) → afterwards');
  check(isAfterwards({ db: makeDb([]).db, kv: makeKv() }) === false,
    'fresh install (nothing at all) → not afterwards');
}

/* ── 4. data decisions ── */

console.log('data decisions');
{
  const kv = makeKv();
  check(JSON.stringify(getDataDecisions(kv)) === '{}', 'undecided by default (decide-later first-class)');
  const d1 = recordDataDecision({ story: 'kept' }, kv);
  check(d1.story === 'kept' && typeof d1.decidedAt === 'string', 'records story decision + timestamp');
  const d2 = recordDataDecision({ partnerMemories: 'removed' }, kv);
  check(d2.story === 'kept' && d2.partnerMemories === 'removed', 'decisions merge across rows');
  check(getDataDecisions(kv).partnerMemories === 'removed', 'decisions persist');
  const d3 = recordDataDecision({ story: 'exported' }, kv);
  check(d3.story === 'exported', 'decisions are changeable');
}
{
  // Corrupt kv → graceful undecided, never throws.
  const kv = makeKv({ [AFTERMATH_KV]: 'not-json{{' });
  check(JSON.stringify(getDataDecisions(kv)) === '{}', 'corrupt storage → undecided');
  // Unknown values are dropped, not trusted.
  const kv2 = makeKv({
    [AFTERMATH_KV]: JSON.stringify({ decisions: { story: 'maybe', partnerMemories: 'kept' } }),
  });
  const d = getDataDecisions(kv2);
  check(d.story === undefined && d.partnerMemories === 'kept', 'unknown decision values dropped');
}

/* ── 5. expand-to-choose state machine ── */

console.log('expand-to-choose');
{
  // Closed → tap → open.
  let s = toggleDataRow({ open: false, decided: false });
  check(s.open && !s.decided, 'tap opens a closed row');
  // Open → tap → closed.
  s = toggleDataRow({ open: true, decided: false });
  check(!s.open && !s.decided, 'tap closes an open row');
  // Choose → quiet decided state, collapsed.
  s = chooseDataRowOption();
  check(!s.open && s.decided, 'choosing collapses into the decided state');
  // Decided → tap → re-opens for changing.
  s = toggleDataRow({ open: false, decided: true });
  check(s.open && !s.decided, 'decided row re-taps open to change');
}

/* ── 6. afterwards content guard ── */

console.log('content guard');
{
  // Developmental / celebratory-pregnancy phrasing must never appear once stopped.
  const banned: RegExp[] = [
    /\bweek\s*\d/i, // "Week 12"
    /week.by.week/i,
    /\bsize of\b/i, // size comparisons
    /trimester/i,
    /your baby is/i,
    /congratulations/i,
    /\btips?\b/i,
  ];
  const gentleCopy = [GENTLE_READS_INTRO, ...GENTLE_READS.flatMap((r) => [r.title, r.blurb])];
  const all = [...ALL_AFTERWARDS_COPY, ...gentleCopy];
  const hits: string[] = [];
  for (const text of all) {
    for (const re of banned) {
      if (re.test(text)) hits.push(`${re} in ${JSON.stringify(text)}`);
    }
  }
  check(hits.length === 0, 'zero developmental content in afterwards strings', hits.join('; '));
  check(GENTLE_READS.length === 3, 'three gentle reads');
  check(
    GENTLE_READS.some((r) => r.title === 'Coping with pregnancy loss'),
    'plain "pregnancy loss" phrasing present',
  );
  check(
    GENTLE_READS.every((r) => r.title && r.blurb && !/reviewed|clinician|doctor/i.test(r.title + r.blurb)),
    'reads never claim clinical review',
  );
  const allText = all.join(' ');
  check(!/reviewed|clinician/i.test(allText), 'no "reviewed"/"clinician" claims anywhere afterwards');
}

/* ── 7. gentle delete guard ── */

console.log('delete guard');
{
  check(confirmDeleteEverything({ confirmed: false }) === 'cancelled', 'unconfirmed → cancelled');
  check(confirmDeleteEverything({ confirmed: true }) === 'deleted', 'explicit confirm → deleted');
  check(/no undo/i.test(DELETE_GUARD_LEDE), 'guard names the permanence ("no undo")');
  check(/take all the time you need/i.test(DELETE_GUARD_LEDE), 'guard is unhurried');
  check(DELETE_GUARD_TITLE === 'Delete everything?', 'guard title');
  check(DELETE_GUARD_KEEP === 'Keep my story' && DELETE_GUARD_CONFIRM === 'Yes, delete everything',
    'guard offers a clear way back');
  check(/export first/i.test(DELETE_GUARD_FINE), 'guard suggests exporting first');
  check(/deleted/i.test(DELETE_GUARD_DELETED_TOAST), 'deletion confirmed plainly afterwards');
}

/* ── counts ── */

console.log('counts');
{
  const { db } = makeDb([], 12, 128);
  check(countSharedMoments(db) === 12, 'shared-moment count');
  check(countMoments(db) === 128, 'timeline moment count');
}

console.log(`\nepic9: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
