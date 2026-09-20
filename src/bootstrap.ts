import { useEffect } from 'react';
import { Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { setArchiveWriter } from './privacy/privacy';
import { supabase } from './lib/supabase';

/**
 * Registers the default archive file writer so Settings → Export works
 * for real (JSON archive in the app's document directory).
 */
export function registerDefaultArchiveWriter(): void {
  setArchiveWriter({
    writeArchive: async (filename: string, json: string) => {
      const dir = FileSystem.documentDirectory ?? '';
      const uri = `${dir}${filename}`;
      await FileSystem.writeAsStringAsync(uri, json);
      return uri;
    },
  });
}

/**
 * Completes email magic-link sign-in. The OTP email links to
 * `willow://...`; when the OS opens it we exchange the code (or set the
 * session from tokens) so the user lands signed in.
 */
export function useMagicLinkHandler(): void {
  useEffect(() => {
    if (!supabase) return;

    const handleUrl = async (url: string | null) => {
      if (!url || !supabase) return;
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) console.warn('[auth] code exchange failed', error.message);
          return;
        }
        // Implicit-style link: tokens in fragment or query.
        const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
        const params = new URLSearchParams(hash || parsed.search);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) console.warn('[auth] setSession failed', error.message);
        }
      } catch (e) {
        console.warn('[auth] magic-link handling failed', e);
      }
    };

    const sub = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
    void Linking.getInitialURL().then((url) => handleUrl(url));
    return () => sub.remove();
  }, []);
}

export { useAnonymousIdentity } from './auth/useAnonymousIdentity';
