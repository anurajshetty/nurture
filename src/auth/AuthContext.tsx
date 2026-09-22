/**
 * Authentication state for Willow (Epic 0.1).
 *
 * Sign-in options:
 *  - Apple Sign-In via expo-apple-authentication (iOS only; the UI layer
 *    hides the button when `AppleAuthentication.isAvailableAsync()` is false).
 *  - Email magic link via `supabase.auth.signInWithOtp`; the link redirects
 *    to `willow://` — the app.json `scheme` must be "willow" and the deep-
 *    link handler must call `supabase.auth.exchangeCodeForSession(url)`.
 *
 * Session is persisted by supabase-js into SecureStore (see lib/supabase.ts).
 * Sign-out clears ONLY the session: local SQLite data stays until the user
 * explicitly deletes their account (see src/privacy/privacy.ts).
 * When the backend is unconfigured, every method throws a descriptive Error
 * the UI can display — sessions are never faked.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isConfigured, AUTH_NOT_CONFIGURED_MESSAGE } from '../lib/supabase';
import { onIdentityResolved } from '../sync/store';

/**
 * Magic-link redirect target. Native uses the app deep link (handled by the
 * bootstrap deep-link listener); web returns to the current page URL so
 * supabase-js can pick the session up from it (detectSessionInUrl). The web
 * URL must be allowlisted in the Supabase dashboard redirect URLs.
 */
function magicLinkRedirectTo(): string {
  if (Platform.OS === 'web') {
    return window.location.href.split(/[?#]/)[0];
  }
  return 'willow://';
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** False when no Supabase credentials are configured (local-only mode). */
  isConfigured: boolean;
  /** Apple Sign-In; throws on unconfigured backend, unavailable device, or missing token. */
  signInWithApple: () => Promise<void>;
  /** Sends an email magic link (redirects to `willow://`); the code is sent, not the session. */
  signInWithEmail: (email: string) => Promise<void>;
  /** Clears the session only; local journal data is untouched. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Throws a UI-displayable error when the backend is not configured. */
function assertConfigured(): void {
  if (!isConfigured || !supabase) throw new Error(AUTH_NOT_CONFIGURED_MESSAGE);
}

/** Provides auth state to the app; wrap the root layout with this. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) {
          setSession(data.session);
          setLoading(false);
          // Sync bug fix (Sept 2026): keep the shared identity cache (and
          // its pending-row sweep) in step with the session.
          onIdentityResolved(data.session?.user?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
        // Covers upgrades (linkIdentity), sign-out, and token refreshes.
        onIdentityResolved(nextSession?.user?.id ?? null);
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isConfigured,
      signInWithApple: async () => {
        assertConfigured();
        const available = await AppleAuthentication.isAvailableAsync();
        if (!available) {
          throw new Error('Apple Sign-In is not available on this device.');
        }
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
        if (!credential.identityToken) {
          throw new Error('Apple Sign-In did not return an identity token.');
        }
        const { error } = await supabase!.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) throw new Error(error.message);
      },
      signInWithEmail: async (email: string) => {
        assertConfigured();
        const { error } = await supabase!.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: magicLinkRedirectTo() },
        });
        if (error) throw new Error(error.message);
        // Magic link sent; the deep-link handler completes sign-in via
        // supabase.auth.exchangeCodeForSession(url). No local state changes here.
      },
      signOut: async () => {
        assertConfigured();
        const { error } = await supabase!.auth.signOut();
        if (error) throw new Error(error.message);
        // Local SQLite data is intentionally left intact — only the session
        // (stored in SecureStore) is cleared. See requestAccountDeletion().
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns the current auth state; must be used inside an AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return ctx;
}
