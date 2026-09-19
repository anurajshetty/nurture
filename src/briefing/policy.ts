/**
 * Daily-refresh policy for the morning briefing (track 4: refresh logic).
 *
 * `refreshBriefing(deps)` is the whole decision logic behind useBriefing,
 * kept dependency-injected so it unit-tests with a fake "today", an
 * in-memory KvStore, and a stubbed edge-function client — no network, no
 * SQLite. The React hook (./useBriefing.ts) is a thin wrapper that wires
 * the real deps (todayISO, sqlite kv, navigator.onLine, buildBriefingContext,
 * fetchBriefing) and re-runs this on mount + screen focus.
 *
 * Refresh policy (device-local day):
 * 1. Build the anonymized context. Null (no due date) → 'empty'.
 * 2. Cache hit for today AND the current week → 'live' with the cached
 *    briefing — even offline, it's today's briefing.
 * 3. Otherwise, if offline (web: navigator.onLine === false) → skip the
 *    fetch: 'offline' with any stale cache, else 'empty'.
 * 4. Else → 'generating', attempt the fetch.
 *    - success → save to cache, 'live'.
 *    - failure → 'offline' with the stale briefing when ANY cache exists
 *      (the UI shows the "yesterday's briefing" banner), else 'empty'.
 * 5. A week change (cached week !== current week) counts as stale and
 *    regenerates, with the same failure fallback as (4).
 *
 * Never throws: every failure path lands on 'offline' or 'empty'.
 */

import type { Briefing, BriefingStatus } from './types';
import type { BriefingContext } from './context';
import { fetchBriefing } from './client';
import {
  getCachedBriefing,
  saveBriefing,
  isFreshFor,
  type KvStore,
} from './cache';

/** Everything refreshBriefing needs; the hook supplies the real ones, tests supply fakes. */
export interface RefreshDeps {
  /** Today as YYYY-MM-DD in the device's local calendar. */
  today: string;
  store: KvStore;
  /**
   * False skips the fetch attempt and goes straight to offline/empty.
   * The hook sets this from navigator.onLine on web; native always
   * attempts (the client enforces the 15s timeout).
   */
  online: boolean;
  /** Track 3's buildBriefingContext (sync or async); null = no due date. */
  buildContext: () => BriefingContext | null | Promise<BriefingContext | null>;
  /** Defaults to the real edge-function client; tests stub this. */
  fetch?: (ctx: BriefingContext) => Promise<Briefing>;
  onUpdate: (status: BriefingStatus, briefing: Briefing | null) => void;
}

/**
 * Runs one refresh pass. Emits 'generating' before the fetch attempt so the
 * UI can show skeletons; emits exactly one terminal status afterwards.
 * Never throws.
 */
export async function refreshBriefing(deps: RefreshDeps): Promise<void> {
  const { today, store, online, buildContext, onUpdate } = deps;
  const fetch = deps.fetch ?? fetchBriefing;
  try {
    let ctx: BriefingContext | null = null;
    try {
      ctx = await buildContext();
    } catch {
      ctx = null;
    }
    if (!ctx || typeof ctx.week !== 'number' || typeof ctx.day !== 'number') {
      // No due date (onboarding skipped) or unusable context — nothing to generate.
      onUpdate('empty', null);
      return;
    }

    const record = getCachedBriefing(store);
    // Keep the un-narrowed reference: isFreshFor is a type guard, so after
    // the check below `record` narrows and can no longer serve as "any cache".
    const stale = record;

    // Today's briefing for the current week: show it, even offline.
    if (isFreshFor(record, today, ctx.week)) {
      onUpdate('live', record.briefing);
      return;
    }

    // Stale or missing cache. Offline → don't burn a doomed fetch.
    if (!online) {
      onUpdate(stale ? 'offline' : 'empty', stale ? stale.briefing : null);
      return;
    }

    onUpdate('generating', null);
    try {
      const briefing = await fetch(ctx);
      try {
        // Best-effort: a failed write must not hide a good briefing.
        saveBriefing(briefing, store, today);
      } catch {
        // Cache write failed — the briefing is still shown live.
      }
      onUpdate('live', briefing);
    } catch {
      // Stale cache (any date/week) → 'offline' with the banner;
      // nothing cached at all → 'empty' with the retry button.
      onUpdate(stale ? 'offline' : 'empty', stale ? stale.briefing : null);
    }
  } catch {
    // Absolute last resort — the hook contract says never throw.
    onUpdate('empty', null);
  }
}
