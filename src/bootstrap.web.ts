/**
 * Web bootstrap for Willow (Metro picks this over `bootstrap.ts` on web).
 *
 * - Archive export downloads the JSON via a Blob URL — no file system on
 *   web, so "export" means "save this file" in the browser.
 * - The magic-link deep-link handler is a no-op: on web supabase-js is
 *   configured with `detectSessionInUrl: true` (see `src/lib/supabase.ts`),
 *   so the session is picked up from the redirect URL automatically.
 */
import { setArchiveWriter } from './privacy/privacy';

/**
 * Registers the web archive file writer so Settings → Export downloads
 * the JSON archive in the browser.
 */
export function registerDefaultArchiveWriter(): void {
  setArchiveWriter({
    writeArchive: async (filename: string, json: string) => {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Let the download start before revoking.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      return filename;
    },
  });
}

/**
 * Completes email magic-link sign-in. No-op on web — supabase-js detects
 * the session in the page URL itself.
 */
export function useMagicLinkHandler(): void {
  // Intentionally empty on web.
}

export { useAnonymousIdentity } from './auth/useAnonymousIdentity';
