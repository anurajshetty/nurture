/**
 * Pure media-shape helpers (Epic 2.3). Zero imports beyond types — safe to
 * unit-test under plain node.
 */

import type { EventAttachment } from '../lib/types';

let fallbackSeq = 0;

/** File extension from a display name, falling back to the MIME type. */
export function extensionFor(name: string, mimeType?: string): string {
  const fromName = name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (fromName) return `.${fromName}`;
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

/**
 * Tolerates both the Epic 2.1 attachment shape ({kind, uri, name,
 * mimeType}) and the Epic 2.3 shape. Unknown input returns null.
 */
export function normalizeAttachment(raw: unknown): EventAttachment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const id =
    typeof a.id === 'string' && a.id ? a.id : `att-${(fallbackSeq += 1)}`;
  const kind = a.kind === 'photo' ? 'photo' : 'file';
  const name = typeof a.name === 'string' && a.name ? a.name : 'attachment';
  const mimeType = typeof a.mimeType === 'string' ? a.mimeType : undefined;
  const size = typeof a.size === 'number' ? a.size : undefined;
  const local_uri =
    typeof a.local_uri === 'string' && a.local_uri
      ? a.local_uri
      : typeof a.uri === 'string' && a.uri
        ? a.uri
        : undefined;
  const upload: EventAttachment['upload'] =
    a.upload === 'done' ? 'done' : a.upload === 'failed' ? 'failed' : 'pending';
  const storage_path = typeof a.storage_path === 'string' ? a.storage_path : undefined;
  return { id, kind, name, mimeType, size, local_uri, upload, storage_path };
}

/**
 * Deterministic cloud object path (bucket stored separately):
 * `{user_id}/{event_id}/{attachment_id}.{ext}`. Re-uploads overwrite the
 * same path — idempotent, retry-safe, never duplicates.
 */
export function storagePathFor(
  userId: string,
  eventId: string,
  a: Pick<EventAttachment, 'id' | 'name' | 'mimeType'>,
): string {
  return `${userId}/${eventId}/${a.id}${extensionFor(a.name, a.mimeType)}`;
}
