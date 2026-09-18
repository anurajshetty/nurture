/**
 * Media cloud backup (Epic 2.3): photo/file bytes for the private
 * `photos` / `files` Supabase Storage buckets.
 *
 * Design (matches the approved investigation):
 * - Text/data sync is untouched: `saveEvent` returns immediately and the
 *   media outbox drains separately — text never waits for media.
 * - Deterministic object paths `{user_id}/{event_id}/{attachment_id}.{ext}`
 *   (bucket stored alongside): re-uploads overwrite the same path, so
 *   retries are idempotent and can never duplicate.
 * - Native: picked files are copied from the picker cache into the app
 *   sandbox at save time (the OS may evict cache URIs), so retries survive
 *   restarts. Web: blob: URIs die with the tab, so uploads run eagerly
 *   right after save; a closed tab means a lost attachment, shown honestly
 *   as "not backed up".
 * - EXIF GPS is stripped from JPEGs at upload time (Anuraj: always).
 * - Reads use short-lived signed URLs; RLS stays enforced — no
 *   service-role key ever touches the device.
 *
 * This module never throws out of its public entry points' core loops;
 * per-item failures are recorded and retried later.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { supabase, isConfigured } from '../lib/supabase';
import { getDb } from '../lib/db';
import { getEvent, setEventAttachments } from './store';
import { looksLikeJpeg, stripGpsFromJpeg } from '../composer/exif';
import { bucketForKind, type EventAttachment } from '../lib/types';
import { extensionFor, normalizeAttachment, storagePathFor } from './mediaShape';

const MAX_ATTEMPTS = 8;
const DRAIN_BATCH = 20;
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
 * Copies a picked file into the app sandbox (native only) so later retries
 * survive picker-cache eviction and app restarts. Returns the sandbox URI,
 * or the original URI when the copy isn't possible.
 */
async function sandboxCopy(eventId: string, attachment: EventAttachment, uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  try {
    const root = new Directory(Paths.document);
    let media: Directory;
    try {
      media = root.createDirectory('media');
    } catch {
      media = new Directory(Paths.document, 'media');
    }
    let eventDir: Directory;
    try {
      eventDir = media.createDirectory(eventId);
    } catch {
      eventDir = new Directory(media, eventId);
    }
    const dest = new File(eventDir, `${attachment.id}${extensionFor(attachment.name, attachment.mimeType)}`);
    if (!dest.exists) {
      await new File(uri).copy(dest);
    }
    return dest.uri;
  } catch {
    return uri;
  }
}

/**
 * Queues an event's attachments for cloud backup. Called right after
 * `saveEvent` — it returns quickly and never touches the network.
 * Already-backed-up attachments are left alone.
 */
export async function enqueueMediaUploads(eventId: string): Promise<void> {
  const attachments = attachmentsOfEvent(eventId);
  if (attachments.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const updated: EventAttachment[] = [];
  for (const a of attachments) {
    if (a.upload === 'done' && a.storage_path) {
      updated.push(a);
      continue;
    }
    const localUri = a.local_uri ? await sandboxCopy(eventId, a, a.local_uri) : undefined;
    const next: EventAttachment = { ...a, local_uri: localUri, upload: 'pending' };
    // Best-effort size for the manifest; never blocks the queue.
    if (next.size == null && localUri && Platform.OS !== 'web') {
      try {
        const s = new File(localUri).size;
        if (s > 0) next.size = s;
      } catch {
        // Size stays unknown — upload proceeds anyway.
      }
    }
    db.runSync(
      `INSERT OR REPLACE INTO media_outbox
         (id, event_id, attachment_id, bucket, local_uri, storage_path, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, '', 'pending', 0, ?)`,
      Crypto.randomUUID(),
      eventId,
      next.id,
      bucketForKind(next.kind),
      next.local_uri ?? '',
      now,
    );
    updated.push(next);
  }
  // Rewrite the event payload with the normalized shape and mark it dirty
  // so the next text sync carries the new attachment metadata.
  setEventAttachments(eventId, updated);
}

/** Reads raw bytes for one outbox row (native file or web blob URL). */
async function readBytes(row: MediaOutboxRow): Promise<Uint8Array> {
  let buffer: ArrayBuffer;
  if (Platform.OS === 'web') {
    const res = await fetch(row.local_uri);
    if (!res.ok) throw new Error(`blob fetch failed (${res.status})`);
    buffer = await res.arrayBuffer();
  } else {
    const file = new File(row.local_uri);
    if (!file.exists) throw new Error('local file missing');
    buffer = await file.arrayBuffer();
  }
  const bytes = new Uint8Array(buffer);
  // Anuraj: strip photo location metadata at upload time — always.
  if (row.bucket === 'photos' && looksLikeJpeg(bytes)) {
    return stripGpsFromJpeg(bytes);
  }
  return bytes;
}

/** Uploads one queued attachment; reconciles the event payload on success. */
async function uploadOne(row: MediaOutboxRow, userId: string): Promise<void> {
  const client = supabase!;
  const db = getDb();
  const event = getEvent(row.event_id);
  if (!event || event.deletedAt) {
    // Event gone or tombstoned: drop the queued bytes, never upload.
    db.runSync('DELETE FROM media_outbox WHERE id = ?', row.id);
    return;
  }
  const attachment = attachmentsOfEvent(row.event_id).find((a) => a.id === row.attachment_id);
  if (!attachment) {
    db.runSync('DELETE FROM media_outbox WHERE id = ?', row.id);
    return;
  }
  const bytes = await readBytes(row);
  const storagePath = storagePathFor(userId, row.event_id, attachment);
  const { error } = await client.storage
    .from(row.bucket)
    .upload(storagePath, bytes, { contentType: attachment.mimeType, upsert: true });
  if (error) throw new Error(error.message);
  const done: EventAttachment = { ...attachment, upload: 'done', storage_path: storagePath };
  db.withTransactionSync(() => {
    db.runSync("UPDATE media_outbox SET status = 'done', storage_path = ? WHERE id = ?", storagePath, row.id);
  });
  // Reconcile the event payload so the server row (and other devices)
  // learn the cloud path. Marks the event dirty + re-queues a text upsert.
  const rest = attachmentsOfEvent(row.event_id).map((a) => (a.id === done.id ? done : a));
  setEventAttachments(row.event_id, rest);
}

let draining = false;

/** Summary of one media-drain pass. */
export interface MediaDrainResult {
  uploaded: number;
  errors: string[];
}

/**
 * Uploads queued media (pending + lightly-failed). Runs after/parallel to
 * the text sync — it never blocks or delays text. No-ops when unconfigured
 * or signed out.
 */
export async function drainMediaOutbox(): Promise<MediaDrainResult> {
  const result: MediaDrainResult = { uploaded: 0, errors: [] };
  if (!isConfigured || !supabase || draining) return result;
  draining = true;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return result;
    const rows = getDb().getAllSync<MediaOutboxRow>(
      `SELECT * FROM media_outbox
       WHERE status IN ('pending', 'failed') AND attempts < ?
       ORDER BY created_at ASC LIMIT ?`,
      MAX_ATTEMPTS,
      DRAIN_BATCH,
    );
    for (const row of rows) {
      try {
        await uploadOne(row, userId);
        result.uploaded += 1;
      } catch (e) {
        getDb().runSync(
          `UPDATE media_outbox
           SET status = 'failed', attempts = attempts + 1 WHERE id = ?`,
          row.id,
        );
        // Honest UI state: mark the attachment failed so the card can say
        // "not backed up". A later drain retries it (attempts < max).
        try {
          const rest = attachmentsOfEvent(row.event_id).map((a) =>
            a.id === row.attachment_id && a.upload !== 'done'
              ? { ...a, upload: 'failed' as const }
              : a,
          );
          setEventAttachments(row.event_id, rest);
        } catch {
          // Payload rewrite is best-effort; the outbox row drives retries.
        }
        result.errors.push(`${row.attachment_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    draining = false;
  }
  return result;
}

/**
 * Cancels queued uploads for an event and removes anything already
 * uploaded (Undo path). Best-effort: never throws.
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
 * buckets. Called after the engine acknowledges an event tombstone, so
 * orphaned uploads can never linger. Best-effort: never throws.
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
