/**
 * Ephemeral report bytes — web implementation (Willow, Sept 2026).
 *
 * Same contract as `./bytes` (native): the picked file is read into
 * memory ONLY to send it inline to the `report-summary` edge function.
 * Nothing is persisted: no DB blob, no Storage upload, no media-outbox
 * row.
 *
 * - Images are downscaled to ≤1600px via canvas and re-encoded as JPEG
 *   0.75 — smaller payload, and it normalizes every browser image type
 *   into Gemini's inline-readable set. (Canvas output carries no EXIF, so
 *   the GPS strip is a no-op here but kept for parity.)
 * - PDFs pass through as-is.
 * - Client-side cap: 10MB.
 */

import { looksLikeJpeg, stripGpsFromJpeg } from '../composer/exif';
import { base64EncodeBytes, type ReportBytes } from './flow';
import type { PendingAttachment } from '../composer/attachments';

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;

export class ReportBytesError extends Error {
  readonly code: 'too_large' | 'unreadable';
  constructor(code: 'too_large' | 'unreadable', message: string) {
    super(message);
    this.name = 'ReportBytesError';
    this.code = code;
  }
}

function loadImage(bytes: Uint8Array, mimeType: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

async function downscaleImage(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const img = await loadImage(bytes, mimeType);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75));
  if (!blob) throw new Error('encode failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Reads the picked attachment into an in-memory `{ dataBase64, mimeType }`
 * pair. Throws ReportBytesError('too_large' | 'unreadable').
 */
export async function readReportBytes(pick: PendingAttachment): Promise<ReportBytes> {
  let raw: Uint8Array;
  try {
    const res = await fetch(pick.uri);
    if (!res.ok) throw new Error(`blob fetch failed (${res.status})`);
    raw = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new ReportBytesError('unreadable', 'Could not read that file.');
  }
  if (raw.length === 0) {
    throw new ReportBytesError('unreadable', 'That file looks empty.');
  }
  let bytes = raw;
  let mimeType = pick.mimeType ?? 'application/octet-stream';
  if (mimeType.startsWith('image/')) {
    try {
      bytes = await downscaleImage(raw, mimeType);
    } catch {
      throw new ReportBytesError('unreadable', 'Could not read that image.');
    }
    mimeType = 'image/jpeg';
  }
  if (bytes.length > MAX_REPORT_BYTES) {
    throw new ReportBytesError(
      'too_large',
      'That file is over 10MB — try a smaller file or a clearer photo.',
    );
  }
  // Canvas output carries no EXIF; kept for parity with native.
  if (looksLikeJpeg(bytes)) bytes = stripGpsFromJpeg(bytes);
  return { dataBase64: base64EncodeBytes(bytes), mimeType };
}
