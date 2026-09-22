/**
 * Sync state for the UI layer (Epic 0.5).
 *
 * `useSync()` exposes the pending outbox count, the last successful sync
 * time, any unresolved conflicts, and the actions to sync or resolve.
 * Conflicts are user-visible state — never silently merged.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import {
  syncNow as engineSyncNow,
  getConflicts,
  resolveConflict as engineResolveConflict,
  getLastSyncedAt,
  type SyncResult,
} from './engine';
import { getPendingCount } from './store';
import { requestSyncAfterSave } from './syncTrigger';
import { drainMediaOutbox } from './media';
import { checkTimezoneNow } from '../time/timezone';
import type { SyncConflict } from '../lib/types';

export type { SyncResult };

export interface SyncContextValue {
  /** Runs one sync pass, then refreshes pendingCount/lastSyncedAt/conflicts. */
  syncNow: () => Promise<SyncResult>;
  /** Number of local ops waiting to be pushed. */
  pendingCount: number;
  /** ISO timestamp of the last successful pull, or null when never synced. */
  lastSyncedAt: string | null;
  /** Unresolved conflicts; resolve each explicitly — never merged silently. */
  conflicts: SyncConflict[];
  /** Resolves one conflict, keeping either the 'local' or 'remote' version. */
  resolveConflict: (id: string, winner: 'local' | 'remote') => void;
  /** Re-reads local sync state (pending count, watermark, conflicts). */
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Provides sync state to the app; wrap the root layout with this (inside AuthProvider). */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const refresh = useCallback(() => {
    try {
      setPendingCount(getPendingCount());
      setLastSyncedAt(getLastSyncedAt());
      setConflicts(getConflicts());
    } catch {
      // Local DB unreadable: keep the last known state rather than crashing UI.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sync-trigger backstop (Sept 2026): a save that somehow missed its
  // debounced trigger — or an offline gap while the app was backgrounded —
  // converges when the user returns. Also fires one debounced pass on
  // mount so app start pulls newer server rows even when nothing was
  // written locally. Silent and coalesced: failures are counted in
  // getSyncDiagnostics(), never thrown into the UI.
  //
  // Timezone-change backstop (Anuraj, Sept 2026): the same foreground/focus
  // moments re-check the device timezone, so a PST → EST trip switches
  // times and day-group boundaries automatically — plus a slow interval for
  // the (rare) case where the zone changes while the app stays foregrounded.
  // checkTimezoneNow() is a no-op until the zone actually changes.
  useEffect(() => {
    let appStateSub: { remove(): void } | undefined;
    let onVisible: (() => void) | undefined;
    let onFocus: (() => void) | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const onForeground = () => {
      requestSyncAfterSave();
      checkTimezoneNow();
    };
    if (Platform.OS === 'web') {
      onVisible = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          onForeground();
        }
      };
      onFocus = () => onForeground();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onFocus);
    } else {
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') onForeground();
      });
    }
    interval = setInterval(checkTimezoneNow, 60_000);
    requestSyncAfterSave();
    checkTimezoneNow();
    return () => {
      appStateSub?.remove();
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
      if (onFocus) window.removeEventListener('focus', onFocus);
      if (interval) clearInterval(interval);
    };
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({
      pendingCount,
      lastSyncedAt,
      conflicts,
      refresh,
      syncNow: async () => {
        const result = await engineSyncNow();
        // Media backup drains on its own queue after text sync — text never
        // waits for media. Fire-and-forget; per-item failures retry later.
        // DISABLED Sept 2026 (PHOTOS_PERSIST_ENABLED = false): drainMediaOutbox
        // is a no-op — no sandbox copies, no uploads, no retries. Call kept so
        // the pipeline can be re-enabled behind the kill switch.
        void drainMediaOutbox().catch(() => {});
        refresh();
        return result;
      },
      resolveConflict: (id: string, winner: 'local' | 'remote') => {
        engineResolveConflict(id, winner);
        refresh();
      },
    }),
    [pendingCount, lastSyncedAt, conflicts, refresh],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** Returns the current sync state; must be used inside a SyncProvider. */
export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside a <SyncProvider>.');
  return ctx;
}
