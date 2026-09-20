/**
 * Anonymous identity boot tests (Willow, Sept 2026 — Anuraj approved).
 *
 * Locked product rules under test:
 * - Fresh install with no session → exactly one signInAnonymously() call.
 * - Existing session (anonymous OR upgraded) → signInAnonymously is NEVER
 *   called: the identity (and its quota history) is preserved.
 * - Any failure (disabled provider, network) → 'failed', no throw; the
 *   app degrades to the shared anonymous bucket and the next boot
 *   retries.
 *
 * Run with:
 *   npx tsc tests/anonymous_identity.test.ts src/auth/anonymousSession.ts \
 *     --outDir /tmp/nurture-anonid-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-anonid-tests/tests/anonymous_identity.test.js
 */

import { ensureAnonymousSession, type AnonymousAuthLike } from '../src/auth/anonymousSession';

// Minimal node surface used here (this suite compiles standalone, with no
// transitive ambient node types in its import graph).
declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(ok: boolean, name: string): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error('FAIL:', name);
  }
}

function fakeAuth(opts: {
  session: { user: { id: string } } | null;
  signInError?: { message: string } | null;
  throwOn?: 'getSession' | 'signIn';
  calls: { signInAnonymously: number };
}): AnonymousAuthLike {
  return {
    async getSession() {
      if (opts.throwOn === 'getSession') throw new Error('network down');
      return { data: { session: opts.session } };
    },
    async signInAnonymously() {
      opts.calls.signInAnonymously++;
      if (opts.throwOn === 'signIn') throw new Error('network down');
      return { error: opts.signInError ?? null };
    },
  };
}

async function main(): Promise<void> {
  {
    // Fresh install: no session → one anonymous sign-in.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(fakeAuth({ session: null, calls }));
    check(outcome === 'signed-in', 'anon-identity: fresh install signs in anonymously');
    check(calls.signInAnonymously === 1, 'anon-identity: fresh install signs in exactly once');
  }
  {
    // Existing anonymous session → reused, never replaced.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(
      fakeAuth({ session: { user: { id: 'anon-uuid-1' } }, calls }),
    );
    check(outcome === 'existing', 'anon-identity: persisted anonymous session is reused');
    check(calls.signInAnonymously === 0, 'anon-identity: existing session is not replaced');
  }
  {
    // Upgraded identity (e.g. linkIdentity later) → preserved, not downgraded.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(
      fakeAuth({ session: { user: { id: 'real-user-uuid' } }, calls }),
    );
    check(outcome === 'existing', 'anon-identity: upgraded session is preserved');
    check(calls.signInAnonymously === 0, 'anon-identity: upgraded session is not replaced');
  }
  {
    // Provider disabled (anonymous_provider_disabled) → failed, no throw.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(
      fakeAuth({ session: null, signInError: { message: 'Anonymous sign-ins are disabled' }, calls }),
    );
    check(outcome === 'failed', 'anon-identity: disabled provider reports failed');
    check(calls.signInAnonymously === 1, 'anon-identity: failed attempt still tried once');
  }
  {
    // getSession throws (network) → failed, no throw; next boot retries.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(fakeAuth({ session: null, throwOn: 'getSession', calls }));
    check(outcome === 'failed', 'anon-identity: getSession failure reports failed');
    check(calls.signInAnonymously === 0, 'anon-identity: no sign-in attempted when getSession fails');
  }
  {
    // signInAnonymously throws → failed, no throw.
    const calls = { signInAnonymously: 0 };
    const outcome = await ensureAnonymousSession(fakeAuth({ session: null, throwOn: 'signIn', calls }));
    check(outcome === 'failed', 'anon-identity: sign-in failure reports failed');
  }

  console.log(`anonymous_identity: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('anonymous_identity crashed:', e);
  process.exit(1);
});
