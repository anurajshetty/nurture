/**
 * Supabase client singleton for Willow.
 *
 * The app MUST boot with or without backend credentials. When
 * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are missing or
 * still hold placeholder values, `isConfigured` is false and `supabase` is
 * null; every data/auth/sync/privacy module degrades gracefully (local-only
 * mode) instead of throwing. Nothing in this file throws on import.
 *
 * Session persistence uses a SecureStore-backed storage adapter because
 * @react-native-async-storage/async-storage is not a dependency.
 */

import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Error message thrown by auth methods when the backend is not configured. */
export const AUTH_NOT_CONFIGURED_MESSAGE =
  'Willow is not connected to a backend yet. ' +
  'Copy .env.example to .env and add your Supabase URL and anon key, then restart the app.';

/** Storage adapter so supabase-js persists the session in the OS keychain/keystore. */
const secureStorageAdapter: SupportedStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

/**
 * Web storage adapter. expo-secure-store has no web implementation, so the
 * session persists in localStorage on web (fine for a test surface; the
 * anon key is public by design and RLS guards the data).
 */
const webStorageAdapter: SupportedStorage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode etc. — session just won't survive reloads.
    }
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Already gone — nothing to do.
    }
    return Promise.resolve();
  },
};

const IS_WEB = Platform.OS === 'web';

/** Returns true only when the env vars look like real Supabase credentials. */
function readIsConfigured(): boolean {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  if (url.includes('your-project') || key.includes('your-anon-key')) return false;
  return url.startsWith('https://') && key.length > 20;
}

/** True when a real Supabase backend is wired up; false means local-only mode. */
export const isConfigured: boolean = readIsConfigured();

/** The Supabase client, or null when the backend is not configured. Never throws. */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: {
        storage: IS_WEB ? webStorageAdapter : secureStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        // On web the magic-link redirect lands on the page URL, so let
        // supabase-js pick the session up from it. Native keeps the
        // deep-link handler (see src/bootstrap.ts) with the PKCE flow.
        detectSessionInUrl: IS_WEB,
        flowType: 'pkce',
      },
    })
  : null;

/** Returns the client, or throws a UI-displayable error when unconfigured. */
export function requireClient(): SupabaseClient {
  if (!supabase) throw new Error(AUTH_NOT_CONFIGURED_MESSAGE);
  return supabase;
}
