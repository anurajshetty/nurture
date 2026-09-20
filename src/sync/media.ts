/**
 * Media cloud backup (Epic 2.3) — DISABLED Sept 2026.
 *
 * Anuraj turned photo persistence OFF app-wide (storage constraint): NO
 * photo gets uploaded or saved anywhere — not to Supabase Storage, not to
 * the local sandbox, for reports OR log entries.
 *
 * Kill switch: PHOTOS_PERSIST_ENABLED in ./photoPersistence (false).
 * enqueueMediaUploads / drainMediaOutbox below are gated on it.
 *
 * This module keeps its public signatures as no-ops so the composer save
 * paths and sync context need no visible changes (the composer photo-UI
 * hide ships separately after Anuraj approves the mockup). The only live
 * behavior left is *deletion* (purge helpers used on undo / tombstone /
 * account deletion) and signed-URL reads of already-stored bytes.
 *
 * Nothing in this module writes photo bytes anywhere. Ever.
 */

import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { supabase, isConfigured } from '../lib/supabase';
import { getDb } from '../lib/db';
import { getEvent } from './store';
import type { EventAttachment } from '../lib/types';
import { normalizeAttachment } from './mediaShape';
import { PHOTOS_PERSIST_ENABLED } from './photoPersistence';

const SIGNED_URL_TTL_MS = 10 * 60 * 1000; // cache signed URLs for 10 minutes

/** Raw media_outbox row as returned by SQLite. */
interface MediaOutboxRow {
  id: string;
  event_id: string;
  attachment_id: string;
  bucket: string;
  local_uri: string;
  storage_path: string;
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  created_at: string;
}

/** Reads every attachment reference stored on an event's data. */
export function attachmentsOfEvent(eventId: string): EventAttachment[] {
  const event = getEvent(eventId);
  if (!event) return [];
  const raw = (event.data as Record<string, unknown>).attachments;
  if (!Array.isArray(raw)) return [];
  const out: EventAttachment[] = [];
  for (const r of raw) {
    const a = normalizeAttachment(r);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Photo persistence OFF (Sept 2026): this is a deliberate no-op. Nothing
 * is copied into the sandbox, nothing is queued for upload, and nothing
 * is marked 'pending'. The signature stays so composer save paths are
 * untouched. Gated on the PHOTOS_PERSIST_ENABLED kill switch in
 * ./photoPersistence — to re-enable, flip the flag AND restore this
 * function's original body (removed Sept 2026; see git history).
 */
export async function enqueueMediaUploads(_eventId: string): Promise<void> {
  // No-op: photos are never uploaded or persisted.
  if (!PHOTOS_PERSIST_ENABLED) return;
}

/** Summary of one media-drain pass. */
export interface MediaDrainResult {
  uploaded: number;
  errors: string[];
}

/**
 * Photo persistence OFF (Sept 2026): never uploads anything. Returns an
 * empty result immediately. The signature stays so the sync context and
 * composer call sites are untouched. Gated on the PHOTOS_PERSIST_ENABLED
 * kill switch in ./photoPersistence — to re-enable, flip the flag AND
 * restore this function's original body (removed Sept 2026; see git
 * history).
 */
export async function drainMediaOutbox(): Promise<MediaDrainResult> {
  // No-op: photos are never uploaded or persisted.
  if (!PHOTOS_PERSIST_ENABLED) return { uploaded: 0, errors: [] };
  return { uploaded: 0, errors: [] };
}

/**
 * Cancels queued uploads for an event and removes anything already
 * uploaded (Undo path). Best-effort: never throws.
 *
 * With uploads disabled this is mostly cleanup of stale local rows and
 * any sandbox copies the old flow left behind.
 */
export async function purgeEventMedia(eventId: string): Promise<void> {
  try {
    const db = getDb();
    const rows = db.getAllSync<MediaOutboxRow>(
      `SELECT * FROM media_outbox WHERE event_id = ? AND storage_path != ''`,
      eventId,
    );
    db.runSync('DELETE FROM media_outbox WHERE event_id = ?', eventId);
    if (rows.length > 0 && isConfigured && supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        const byBucket = new Map<string, string[]>();
        for (const r of rows) {
          const list = byBucket.get(r.bucket) ?? [];
          list.push(r.storage_path);
          byBucket.set(r.bucket, list);
        }
        for (const [bucket, paths] of byBucket) {
          await supabase.storage.from(bucket).remove(paths);
        }
      }
    }
    // Drop sandbox copies for the event (native only).
    if (Platform.OS !== 'web') {
      try {
        const dir = new Directory(Paths.document, 'media', eventId);
        if (dir.exists) dir.delete();
      } catch {
        // Best-effort cleanup.
      }
    }
  } catch {
    // Never let media cleanup break the delete/undo flow.
  }
}

/**
 * Deletes every stored object under `{user_id}/{event_id}/` in both
 * buckets. Kept for hygiene (stale bytes from before uploads were
 * disabled); called from the sync engine after a tombstone is
 * acknowledged. Best-effort: never throws.
 */
export async function purgeEventMediaByPrefix(userId: string, eventId: string): Promise<void> {
  if (!isConfigured || !supabase) return;
  try {
    for (const bucket of ['photos', 'files'] as const) {
      const prefix = `${userId}/${eventId}`;
      let offset = 0;
      for (;;) {
        const { data, error } = await supabase.storage.from(bucket).list(prefix, {
          limit: 100,
          offset,
        });
        if (error || !data || data.length === 0) break;
        const paths = data.map((f) => `${prefix}/${f.name}`);
        const { error: rmError } = await supabase.storage.from(bucket).remove(paths);
        if (rmError) break;
        if (data.length < 100) break;
        offset += data.length;
      }
    }
  } catch {
    // Orphan cleanup is best-effort; a later pass retries.
  }
}

/**
 * Deletes ALL of a user's stored objects in both buckets (account
 * deletion). Throws with context on persistent failure so the caller can
 * surface it — deleting the account must not silently leave bytes behind.
 */
export async function purgeAllUserMedia(userId: string): Promise<void> {
  if (!isConfigured || !supabase) return;
  const client = supabase;
  for (const bucket of ['photos', 'files'] as const) {
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage.from(bucket).list(userId, {
        limit: 100,
        offset,
      });
      if (error) throw new Error(`Media deletion failed (${bucket}): ${error.message}`);
      if (!data || data.length === 0) break;
      // list() is not recursive: entries may be event-id folders or files.
      const paths: string[] = [];
      for (const entry of data) {
        if (entry.id == null) {
          // Folder — list one level deeper.
          const { data: kids, error: kErr } = await client.storage.from(bucket).list(
            `${userId}/${entry.name}`,
            { limit: 100 },
          );
          if (kErr) throw new Error(`Media deletion failed (${bucket}): ${kErr.message}`);
          for (const k of kids ?? []) paths.push(`${userId}/${entry.name}/${k.name}`);
        } else {
          paths.push(`${userId}/${entry.name}`);
        }
      }
      if (paths.length > 0) {
        const { error: rmError } = await client.storage.from(bucket).remove(paths);
        if (rmError) throw new Error(`Media deletion failed (${bucket}): ${rmError.message}`);
      }
      if (data.length < 100) break;
      offset += data.length;
    }
  }
}

/** Short-lived signed-URL cache for rendering cloud-backed attachments. */
const signedUrlCache = new Map<string, { url: string; exp: number }>();

/**
 * Returns a short-lived signed URL for a stored object, or null when it
 * can't be minted (offline, signed out, unconfigured). Cached for 10 min.
 * Read-only: never writes bytes.
 */
export async function getSignedMediaUrl(bucket: string, storagePath: string): Promise<string | null> {
  if (!isConfigured || !supabase) return null;
  const key = `${bucket}/${storagePath}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.exp > Date.now()) return cached.url;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) return null;
    signedUrlCache.set(key, { url: data.signedUrl, exp: Date.now() + SIGNED_URL_TTL_MS });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Removes the local sandbox media cache (native; account deletion). Never throws. */
export async function clearLocalMediaCache(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(Paths.document, 'media');
    if (dir.exists) dir.delete();
  } catch {
    // Best-effort.
  }
}

/** Counts media items still waiting for (or failing) backup. */
export function getPendingMediaCount(): number {
  try {
    const row = getDb().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM media_outbox WHERE status IN ('pending', 'failed')`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
