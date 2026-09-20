/**
 * Anonymous identity boot logic (Anuraj, Sept 20, 2026).
 *
 * Import-free on purpose: the pure decision logic lives here so unit
 * tests can load it in plain node. The React hook
 * (useAnonymousIdentity.ts) wraps it.
 */

/** Minimal surface of supabase.auth used here — lets tests inject fakes. */
export interface AnonymousAuthLike {
  getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  signInAnonymously(): Promise<{ error: { message: string } | null }>;
}

/**
 * Ensure an anonymous identity exists.
 *
 * - Existing session (anonymous, or later upgraded via linkIdentity) →
 *   kept: signInAnonymously is NEVER called, so quota history survives.
 * - No session → one anonymous sign-in attempt.
 * - Any failure → 'failed': the caller logs a warning, chat degrades
 *   to the server's shared anonymous bucket, and the next boot retries.
 */
export async function ensureAnonymousSession(
  auth: AnonymousAuthLike,
): Promise<'existing' | 'signed-in' | 'failed'> {
  try {
    const { data } = await auth.getSession();
    if (data?.session) return 'existing';
    const { error } = await auth.signInAnonymously();
    return error ? 'failed' : 'signed-in';
  } catch {
    return 'failed';
  }
}
