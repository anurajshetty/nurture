/**
 * Debounced "please sync" signal for every local entry mutation
 * (sync-trigger fix, Sept 2026 — Anuraj found in live verification that
 * nothing pushed after saves, so the outbox grew forever and production
 * `events` stayed at 0 rows).
 *
 * Every entry-mutating path in `src/sync/store.ts` (writes, visibility
 * flips, deletes) calls `requestSyncAfterSave()` after the local write.
 * Rapid successive saves coalesce into ONE push on the trailing edge
 * (~1.5s) — no network storm per save.
 *
 * Design notes:
 * - Non-blocking: the save celebration never waits on the network.
 * - Never throws: sync must never break a save. Push failures are
 *   counted by the engine itself (`getSyncDiagnostics`), so this layer
 *   just swallows — the engine already records them.
 * - No-op until a runner is registered: unit tests that import the store
 *   without the engine stay quiet; tests can register a fake.
 * - This module imports nothing internal: `src/sync/engine.ts` imports
 *   `src/sync/store.ts`, so the trigger must not import the engine back
 *   (circular). The engine registers itself at module load; the store
 *   only knows this module.
 */

export type SyncRunner = () => Promise<unknown>;

let runner: SyncRunner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let debounceMs = 1500;

/** Called once at boot by `src/sync/engine.ts` (module load). */
export function registerSyncRunner(r: SyncRunner): void {
  runner = r;
}

/** Test seam: shrink the debounce so unit tests don't wait 1.5s. */
export function setSyncTriggerDebounceMs(ms: number): void {
  debounceMs = ms;
}

/**
 * Test seam: drop any pending debounced sync and restore defaults.
 * Also used by app teardown paths if any are ever added.
 */
export function resetSyncTriggerForTests(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  runner = null;
  debounceMs = 1500;
}

/**
 * Requests one sync pass on the trailing edge of recent writes. Coalesces
 * bursts: each call resets the 1.5s window. Never throws, never awaits.
 */
export function requestSyncAfterSave(): void {
  if (timer !== null) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    const r = runner;
    if (!r) return;
    try {
      const p = r();
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => {
          // Push failures are counted by the engine itself
          // (`getSyncDiagnostics`); never let them surface here.
        });
      }
    } catch {
      // A scheduled sync must never break anything — least of all a save.
    }
  }, debounceMs);
}
