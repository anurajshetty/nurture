/**
 * Daily-refresh cache for the morning briefing (track 4: refresh logic).
 *
 * The briefing is cached in the app's local key/value store
 * (`src/lib/db` kvGet/kvSet — the same pattern the timeline uses), keyed by
 * device-local calendar day. The refresh policy (see ./policy.ts) treats a
 * record as fresh only when BOTH the date and the pregnancy week match.
 *
 * The store is injectable so the pure date logic unit-tests without
 * SQLite; production passes nothing and gets the real kv store.
 */

import type { Briefing } from './types';
import { todayISO } from '../onboarding/dates';

/** Cache key — bump the suffix if the stored shape ever changes. */
export const BRIEFING_CACHE_KEY = 'briefing.cache.v1';

/** One cached briefing, as stored under BRIEFING_CACHE_KEY. */
export interface BriefingCacheRecord {
  /** Device-local day the briefing was generated for, YYYY-MM-DD. */
  generatedForDate: string;
  /** Pregnancy week the briefing was generated for. */
  week: number;
  briefing: Briefing;
}

/** Minimal key/value surface; the app's SQLite kv store implements this. */
export interface KvStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

declare const require: (id: string) => unknown;

/**
 * The production store, resolved lazily so importing this module in a
 * node test runner never touches expo-sqlite. (Metro resolves '../lib/db'
 * to db.web.ts on web — same kvGet/kvSet API.)
 */
export function defaultStore(): KvStore {
  const db = require('../lib/db') as {
    kvGet(key: string): string | null;
    kvSet(key: string, value: string): void;
  };
  return {
    get: (key) => db.kvGet(key),
    set: (key, value) => db.kvSet(key, value),
  };
}

/** Reads the cached briefing record; null when empty, corrupt, or unreadable. Never throws. */
export function getCachedBriefing(store: KvStore = defaultStore()): BriefingCacheRecord | null {
  let raw: string | null = null;
  try {
    raw = store.get(BRIEFING_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BriefingCacheRecord>;
    if (typeof parsed.generatedForDate !== 'string') return null;
    if (typeof parsed.week !== 'number') return null;
    const b = parsed.briefing as Partial<Briefing> | undefined;
    if (!b || typeof b !== 'object' || !Array.isArray(b.cards)) return null;
    return parsed as BriefingCacheRecord;
  } catch {
    return null;
  }
}

/**
 * Caches a briefing as today's (device-local day). `today` is injectable
 * for tests; production callers omit it.
 */
export function saveBriefing(
  briefing: Briefing,
  store: KvStore = defaultStore(),
  today: string = todayISO(),
): void {
  const record: BriefingCacheRecord = {
    generatedForDate: today,
    week: briefing.week,
    briefing,
  };
  store.set(BRIEFING_CACHE_KEY, JSON.stringify(record));
}

/** Drops the cached briefing. Best-effort; never throws. */
export function clearBriefing(store: KvStore = defaultStore()): void {
  try {
    store.set(BRIEFING_CACHE_KEY, '');
  } catch {
    // Already gone — nothing to do.
  }
}

/**
 * Pure date logic: is this record today's briefing for the given
 * pregnancy week? A new day OR a week change both count as stale and
 * trigger regeneration.
 */
export function isFreshFor(
  record: BriefingCacheRecord | null,
  today: string,
  week: number,
): record is BriefingCacheRecord {
  return (
    record !== null && record.generatedForDate === today && record.week === week
  );
}
