/**
 * Shared anonymous-identity cache (sync user_id bug fix, Sept 2026).
 *
 * Root cause of the bug: entries created before the anonymous identity
 * resolved were stamped `user_id = NULL` locally; the sync outbox pushed
 * them as-is; the owner-only RLS policy rejected every push; retries
 * re-pushed the same null id forever — it never self-healed.
 *
 * This module is the single place that knows the current identity:
 * - The boot hook (`useAnonymousIdentity`) and `AuthProvider` report the
 *   resolved user id here via `noteIdentityUserId` (null when signed out
 *   or when identity resolution failed).
 * - `saveEvent` stamps `getIdentityUserId()` so creation paths get the
 *   resolved identity instead of always-null.
 * - `awaitIdentityUserId` lets creation paths gate on boot resolution
 *   before stamping (see `saveEventAwaitingIdentity` in `src/sync/store`).
 *
 * Import-free on purpose: the pure cache logic lives here so unit tests
 * can load it in plain node. The React/DB wiring lives in
 * `src/sync/store.ts` (`onIdentityResolved`) and the auth components.
 */

let cachedUserId: string | null = null;
let settled = false;
let waiters: Array<(id: string | null) => void> = [];

/**
 * Records the currently-resolved identity. Called at boot (anonymous
 * sign-in outcome), on every auth-state change (upgrades, sign-out), and
 * never anywhere else. Idempotent.
 */
export function noteIdentityUserId(userId: string | null): void {
  cachedUserId = userId;
  settled = true;
  const pending = waiters;
  waiters = [];
  for (const notify of pending) {
    try {
      notify(userId);
    } catch {
      // A waiter must never break identity bookkeeping.
    }
  }
}

/** The last resolved user id, or null when unresolved / signed out. Never throws. */
export function getIdentityUserId(): string | null {
  return cachedUserId;
}

/** True once boot (or an auth change) has reported an outcome — even a null one. */
export function isIdentitySettled(): boolean {
  return settled;
}

/**
 * Resolves with the current user id once boot has reported an outcome.
 * Resolves immediately when already settled. On timeout resolves with
 * whatever is cached (null when identity never resolved) — callers treat
 * null as "local-only, visibly pending", never as a value to sync.
 */
export function awaitIdentityUserId(timeoutMs = 8000): Promise<string | null> {
  if (settled) return Promise.resolve(cachedUserId);
  return new Promise((resolve) => {
    const done = (id: string | null): void => {
      clearTimeout(timer);
      const i = waiters.indexOf(done);
      if (i >= 0) waiters.splice(i, 1);
      resolve(id);
    };
    const timer = setTimeout(() => done(cachedUserId), timeoutMs);
    waiters.push(done);
  });
}

/** Test-only: restores the un-booted state between suites. Never called in the app. */
export function resetIdentityForTests(): void {
  cachedUserId = null;
  settled = false;
  waiters = [];
}
