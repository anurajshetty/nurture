/**
 * Attachment picking for the composer — native implementation (Epic 2.1).
 *
 * Camera / photo library via expo-image-picker, documents (PDFs) via
 * expo-document-picker. Attachments are returned as local references and
 * stored on the event's `data.attachments`; the bytes stay on the device
 * (a media-upload step will attach them to Supabase storage in a later
 * epic). Attachments are private by default — the event's visibility is
 * always 'private' unless she changes it later.
 */

import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface PendingAttachment {
  id: string;
  kind: 'photo' | 'video' | 'file';
  /** Local URI (file:// on device, blob: on web). */
  uri: string;
  /** Display name, e.g. "growth-scan-report.pdf". */
  name: string;
  mimeType?: string;
}

function fileName(uri: string, fallback: string): string {
  const tail = uri.split('/').pop()?.split('?')[0];
  return tail && tail.length > 0 ? tail : fallback;
}

function toPhoto(uri: string, mimeType?: string): PendingAttachment {
  return {
    id: Crypto.randomUUID(),
    kind: 'photo',
    uri,
    name: fileName(uri, 'photo.jpg'),
    mimeType,
  };
}

/**
 * Takes a photo with the camera. Returns [] when permission is denied
 * or she backs out — the caller shows nothing in that case.
 */
export async function pickFromCamera(): Promise<PendingAttachment[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => toPhoto(a.uri, a.mimeType));
}

/** Picks photos from the library (multi-select). v1 is photos + PDFs only — no video. */
export async function pickFromLibrary(): Promise<PendingAttachment[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    id: Crypto.randomUUID(),
    kind: 'photo' as const,
    uri: a.uri,
    name: a.fileName ?? fileName(a.uri, 'photo.jpg'),
    mimeType: a.mimeType,
  }));
}

/** Picks a document (PDFs, scan images) from the Files app. */
export async function pickDocument(): Promise<PendingAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    id: Crypto.randomUUID(),
    kind: 'file' as const,
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType,
  }));
}

/** No-op on native: file:// URIs need no cleanup. Kept for API parity with web. */
export function revokeAttachmentUris(_attachments: PendingAttachment[]): void {}
