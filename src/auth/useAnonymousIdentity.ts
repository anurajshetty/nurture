import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ensureAnonymousSession } from './anonymousSession';

/**
 * Anonymous sign-in at app boot (Anuraj, Sept 20, 2026).
 *
 * Every install gets a server-issued, JWT-backed identity the first
 * time the app launches — invisibly: no UI, no forms, no copy changes.
 * The session persists (SecureStore on iOS, localStorage on web), so
 * the identity survives relaunches. Ask Willow's quota is keyed on
 * this identity server-side (per-install 30/day).
 *
 * Idempotent: when a session already exists (anonymous, or a later
 * upgrade via linkIdentity), nothing happens — the existing identity
 * is kept, so quota history survives. Failures are quiet
 * (console.warn only): chat degrades to the server's shared anonymous
 * bucket rather than a dead screen, and the next boot retries.
 */
export function useAnonymousIdentity(): void {
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const outcome = await ensureAnonymousSession(supabase.auth);
      if (outcome === 'failed' && !cancelled) {
        console.warn('[auth] anonymous sign-in unavailable; chat uses the shared anonymous bucket');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
