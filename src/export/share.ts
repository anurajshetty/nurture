/**
 * Epic 8 — OB-visit export: share / print handoff.
 *
 * - Native (iOS): writes the generated HTML summary to the app's cache
 *   directory (expo-file-system v57 `File`/`Paths` API — the legacy
 *   `writeAsStringAsync` API no longer exists in SDK 57) and opens the
 *   system share sheet via React Native `Share.share({ url })`. The iOS
 *   activity view controller offers AirDrop, Mail, Print, and Save to
 *   Files for an HTML file — the app itself never sends anything.
 * - Web: triggers a file download via a Blob + anchor (the test surface).
 *
 * Nothing leaves the device except through her explicit share action.
 * The payload is HTML (not PDF) for v1 — see `renderSummaryHtml` for the
 * documented rationale.
 */

import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';

export type ShareMethod = 'share-sheet' | 'download';

export interface ShareResult {
  ok: boolean;
  method: ShareMethod;
  filename: string;
  /** Set when the handoff failed (surfaced as a gentle toast, never a crash). */
  error?: string;
}

/** e.g. "visit-summary-2026-09-18.html" — stamped in the viewer's local day. */
export function summaryFilename(generatedAtISO: string): string {
  const d = new Date(generatedAtISO);
  if (Number.isNaN(d.getTime())) return 'visit-summary-summary.html';
  // Local calendar day (Anuraj, Sept 2026: every timestamp renders in the
  // viewer's local device timezone) — never the UTC slice.
  const stamp =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`;
  return `visit-summary-${stamp}.html`;
}

/**
 * Hands the rendered summary to the platform: iOS share sheet on native,
 * file download on web. Returns quickly; the OS owns the sheet afterwards.
 */
export async function shareSummaryHtml(html: string, filename: string): Promise<ShareResult> {
  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      // The anchor must be in the DOM for the click to trigger a download.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { ok: true, method: 'download', filename };
    } catch (err) {
      return {
        ok: false,
        method: 'download',
        filename,
        error: err instanceof Error ? err.message : 'Download failed.',
      };
    }
  }

  try {
    // Cache dir: the OS may purge it under storage pressure — fine for a
    // generated-on-demand summary.
    const file = new File(Paths.cache, filename);
    const stream = file.writableStream();
    const writer = stream.getWriter();
    await writer.write(new TextEncoder().encode(html));
    await writer.close();
    await Share.share({ url: file.uri, title: 'Visit summary' });
    return { ok: true, method: 'share-sheet', filename };
  } catch (err) {
    return {
      ok: false,
      method: 'share-sheet',
      filename,
      error: err instanceof Error ? err.message : 'Could not open the share sheet.',
    };
  }
}
