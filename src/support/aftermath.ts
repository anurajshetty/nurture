/**
 * Epic 9 — changed-outcome logic.
 *
 * Owns the stop transition (contract C3): the ONLY stop signal in the app
 * is `pregnancy.status === 'stopped'`. The store's savePregnancy() hard-codes
 * status='active', so the transition runs as a direct, explicit UPDATE here
 * (plus a pregnancy_outbox upsert op so the stopped status syncs).
 *
 * Also owns: the reminder-halt prefs patch, the afterwards predicate, the
 * owner's data decisions (kv-persisted; "decide later" is first-class), the
 * expand-to-choose row state machine, and the gentle-delete guard.
 *
 * DB access is dependency-injected (lazy require with injectable fakes) so
 * unit tests run under plain node without expo-sqlite. Production callers
 * just call the functions with no arguments.
 */

import type { AftermathDecisions, PartnerMemoryDecision, Prefs, StoryDecision } from '../lib/types';

// Metro only bundles `require()` with a static string literal — these lazy
// requires keep DB access out of module scope so unit tests (plain node, no
// expo-sqlite) can inject fakes. Same pattern as src/briefing/cache.ts.
declare const require: (id: string) => unknown;

/** Minimal DB surface this module needs (satisfied by getDb()). */
export interface DbLike {
  runSync(sql: string, ...params: unknown[]): void;
  getAllSync<T>(sql: string, ...params: unknown[]): T[];
}

/** Minimal kv surface (satisfied by kvGet/kvSet). */
export interface KvLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** kv key for the aftermath record: { stoppedAt, decisions }. */
export const AFTERMATH_KV = 'epic9.aftermath';

function defaultDb(): DbLike {
  // Lazy so unit tests (plain node, no expo-sqlite) can inject fakes.
  const db = require('../lib/db') as { getDb(): DbLike };
  return db.getDb();
}

function defaultKv(): KvLike {
  const db = require('../lib/db') as {
    kvGet(key: string): string | null;
    kvSet(key: string, value: string): void;
  };
  return { get: db.kvGet, set: db.kvSet };
}

function defaultUuid(): string {
  const crypto = require('expo-crypto') as { randomUUID(): string };
  return crypto.randomUUID();
}

export interface StopDeps {
  db?: DbLike;
  kv?: KvLike;
  uuid?: () => string;
  now?: () => string;
}

/**
 * The stop transition (contract C3). Marks every active pregnancy
 * 'stopped', queues an upsert op per pregnancy so the status syncs, and
 * records the aftermath flag (survives everything short of full deletion).
 * Idempotent: a second call stops nothing new and returns [].
 *
 * Never asks why. Never touches clinical data.
 */
export function stopPregnancyTracking(deps?: StopDeps): string[] {
  const db = deps?.db ?? defaultDb();
  const kv = deps?.kv ?? defaultKv();
  const genId = deps?.uuid ?? defaultUuid;
  const nowISO = deps?.now?.() ?? new Date().toISOString();

  const actives = db.getAllSync<{ id: string }>(
    `SELECT id FROM pregnancies WHERE status = 'active'`,
  );
  db.runSync(
    `UPDATE pregnancies SET status = 'stopped', updated_at = ?, dirty = 1 WHERE status = 'active'`,
    nowISO,
  );
  for (const row of actives) {
    db.runSync(
      `INSERT INTO pregnancy_outbox (id, pregnancy_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
      genId(),
      row.id,
      nowISO,
    );
  }
  kv.set(AFTERMATH_KV, JSON.stringify({ stoppedAt: nowISO, decisions: readDecisions(kv) }));
  return actives.map((r) => r.id);
}

/**
 * The prefs patch that halts reminders when stopping: end-of-day nudge off,
 * appointment reminders off, everything paused until she returns.
 * Applied through updatePrefs() (which merges over her other prefs).
 */
export function stopReminderPatch(nowISO: string): Partial<Prefs> {
  return {
    endOfDayEnabled: false,
    appointmentReminders: false,
    globalPauseUntil: nowISO,
  };
}

/**
 * Contract C3 predicate: true when the pregnancy has stopped.
 * An active pregnancy always wins (a future return supersedes the past);
 * otherwise a stopped pregnancy — or the aftermath flag left by a stop
 * that ended in full deletion — means afterwards mode.
 */
export function isAfterwards(deps?: { db?: DbLike; kv?: KvLike }): boolean {
  const db = deps?.db ?? defaultDb();
  const kv = deps?.kv ?? defaultKv();
  let statuses: string[];
  try {
    statuses = db
      .getAllSync<{ status: string }>(`SELECT status FROM pregnancies`)
      .map((r) => r.status);
  } catch {
    return false;
  }
  if (statuses.includes('active')) return false;
  if (statuses.includes('stopped')) return true;
  try {
    return kv.get(AFTERMATH_KV) !== null;
  } catch {
    return false;
  }
}

/** Reads the owner's data decisions ({} when undecided — decide-later is first-class). */
export function getDataDecisions(kv: KvLike = defaultKv()): AftermathDecisions {
  return readDecisions(kv);
}

function readDecisions(kv: KvLike): AftermathDecisions {
  let raw: string | null = null;
  try {
    raw = kv.get(AFTERMATH_KV);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { decisions?: AftermathDecisions };
    const d = parsed.decisions ?? {};
    const out: AftermathDecisions = {};
    if (d.story === 'kept' || d.story === 'exported' || d.story === 'deleted') out.story = d.story;
    if (d.partnerMemories === 'kept' || d.partnerMemories === 'removed')
      out.partnerMemories = d.partnerMemories;
    return out;
  } catch {
    return {};
  }
}

/**
 * Records one data decision, merging over earlier ones, stamping decidedAt.
 * Never throws: a failed write keeps the in-memory merge for the session.
 */
export function recordDataDecision(
  patch: { story?: StoryDecision; partnerMemories?: PartnerMemoryDecision },
  kv: KvLike = defaultKv(),
): AftermathDecisions {
  const merged: AftermathDecisions = {
    ...readDecisions(kv),
    ...patch,
    decidedAt: new Date().toISOString(),
  };
  try {
    let stoppedAt: string | null = null;
    try {
      const raw = kv.get(AFTERMATH_KV);
      stoppedAt = raw ? (JSON.parse(raw) as { stoppedAt?: string }).stoppedAt ?? null : null;
    } catch {
      stoppedAt = null;
    }
    kv.set(AFTERMATH_KV, JSON.stringify({ stoppedAt, decisions: merged }));
  } catch {
    // Storage unavailable — the caller still applies the merge locally.
  }
  return merged;
}

/** Non-deleted events with visibility 'shared' — "N shared moments". */
export function countSharedMoments(db: DbLike = defaultDb()): number {
  try {
    const rows = db.getAllSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE visibility = 'shared' AND deleted_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Non-deleted events — the timeline's moment count. */
export function countMoments(db: DbLike = defaultDb()): number {
  try {
    const rows = db.getAllSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/* ── Expand-to-choose row state machine (pure) ── */

export type DataRowId = 'story-keep' | 'story-export' | 'story-delete' | 'partner';

export interface DataRowState {
  open: boolean;
  decided: boolean;
}

/**
 * Tapping a row header: a decided row re-opens so she can change her mind
 * (decided state clears); otherwise the row toggles open/closed.
 */
export function toggleDataRow(state: DataRowState): DataRowState {
  if (state.decided) return { open: true, decided: false };
  return { open: !state.open, decided: false };
}

/** Tapping an option: the row collapses into its quiet decided state. */
export function chooseDataRowOption(): DataRowState {
  return { open: false, decided: true };
}

/* ── Gentle delete guard (pure) ── */

/**
 * "Delete everything" only proceeds on an explicit, unhurried confirmation.
 * The UI must present the guard copy (DELETE_GUARD_* in afterwardsCopy.ts)
 * and call this with confirmed=true only from the "Yes, delete everything"
 * button — never from the row option itself.
 */
export function confirmDeleteEverything(guard: { confirmed: boolean }): 'deleted' | 'cancelled' {
  return guard.confirmed ? 'deleted' : 'cancelled';
}
