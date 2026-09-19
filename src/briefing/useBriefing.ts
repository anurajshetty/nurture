/**
 * Morning-briefing hook (track 4: refresh logic).
 *
 * useBriefing(): { status, briefing, retry } — the whole daily-refresh
 * policy lives in ./policy.ts (refreshBriefing); this hook only wires the
 * real dependencies and re-runs a refresh on mount, on screen focus, and
 * when retry() is called.
 *
 * - status 'live'      → today's briefing (from cache or fresh fetch).
 * - status 'generating'→ a fetch is in flight; briefing is null (skeletons).
 * - status 'offline'   → fetch failed or skipped; briefing is the last
 *                         cached briefing (stale) for the banner state.
 * - status 'empty'     → nothing to show (no due date, or fetch failed
 *                         with no cache); briefing is null, UI shows retry.
 *
 * Never throws: every failure path lands on 'offline' or 'empty'.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Briefing, BriefingStatus } from './types';
import type { BriefingContext } from './context';
import { buildBriefingContext, getRecentNoteLogs } from './context';
import { defaultStore, type KvStore } from './cache';
import { phrasePlan } from './client';
import { refreshBriefing } from './policy';
import { todayISO } from '../onboarding/dates';

/**
 * Network fast-path: on web, navigator.onLine === false skips the fetch
 * attempt and goes straight to offline/empty. On native we always attempt
 * (the client enforces the 15s timeout).
 */
function isOnlineNow(): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return navigator.onLine !== false;
  }
  return true;
}

export function useBriefing(): {
  status: BriefingStatus;
  briefing: Briefing | null;
  retry: () => void;
} {
  const [status, setStatus] = useState<BriefingStatus>('generating');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  // Bumped by retry(); the effect below re-runs the refresh for each value.
  const [attempt, setAttempt] = useState(0);
  const storeRef = useRef<KvStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = defaultStore();
  }

  const runRefresh = useCallback(() => {
    let cancelled = false;
    const buildContext = (): BriefingContext | null => buildBriefingContext();
    void refreshBriefing({
      today: todayISO(),
      store: storeRef.current as KvStore,
      online: isOnlineNow(),
      buildContext,
      getRecentLogs: () => getRecentNoteLogs(),
      phrase: (req) => phrasePlan(req),
      onUpdate: (s, b) => {
        if (!cancelled) {
          setStatus(s);
          setBriefing(b);
        }
      },
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount (+ retry) …
  useEffect(() => runRefresh(), [runRefresh, attempt]);
  // … and every time the Home tab regains focus (catches day rollover).
  useFocusEffect(
    useCallback(() => {
      const cleanup = runRefresh();
      return cleanup;
    }, [runRefresh]),
  );

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { status, briefing, retry };
}
