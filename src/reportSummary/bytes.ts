/**
 * Ephemeral report bytes — native implementation (Willow, Sept 2026).
 *
 * Reads a picked report file into memory ONLY to send it inline to the
 * `report-summary` edge function. Nothing is persisted: no DB blob, no
 * Storage upload, no media-outbox row.
 *
 * - Images (camera scans, library photos) are downscaled to ≤1600px and
 *   re-encoded as JPEG 0.75 first — smaller payload, and it normalizes
 *   HEIC/PNG/WebP into the one type Gemini reads inline.
 * - PDFs pass through as-is.
 * - Client-side cap: 10MB. Anything larger is refused with 'too_large'.
 * - EXIF GPS is stripped from JPEGs (Anuraj: always).
 */

import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { looksLikeJpeg, stripGpsFromJpeg } from '../composer/exif';
import { base64EncodeBytes, type ReportBytes } from './flow';
import type { PendingAttachment } from '../composer/attachments';

/** Client-side cap: documents larger than this are refused, never sent. */
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

/** Longest side of a downscaled report photo, in pixels. */
const MAX_PHOTO_DIMENSION = 1600;

export class ReportBytesError extends Error {
  readonly code: 'too_large' | 'unreadable';
  constructor(code: 'too_large' | 'unreadable', message: string) {
    super(message);
    this.name = 'ReportBytesError';
    this.code = code;
  }
}

/** Local-file image dimensions; null when the image can't be decoded. */
function imageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null),
      () => resolve(null),
    );
  });
}

/**
 * Reads the picked attachment into an in-memory `{ dataBase64, mimeType }`
 * pair. Throws ReportBytesError('too_large' | 'unreadable'). The caller
 * sends the pair straight to the edge function and drops it afterwards.
 */
export async function readReportBytes(pick: PendingAttachment): Promise<ReportBytes> {
  let uri = pick.uri;
  let mimeType = pick.mimeType ?? 'application/octet-stream';
  if (mimeType.startsWith('image/')) {
    // Downscale camera/library photos before sending. Only when the
    // longest edge exceeds the cap (never upscale small images); resize
    // along the longest edge so the aspect ratio is preserved. The
    // re-encode to JPEG also normalizes HEIC/PNG/WebP into Gemini's
    // inline-readable set, so it runs even when no resize is needed.
    const size = await imageSize(uri);
    const actions =
      size && Math.max(size.width, size.height) > MAX_PHOTO_DIMENSION
        ? [
            {
              resize:
                size.width >= size.height
                  ? { width: MAX_PHOTO_DIMENSION }
                  : { height: MAX_PHOTO_DIMENSION },
            },
          ]
        : [];
    try {
      const manip = await manipulateAsync(uri, actions, {
        compress: 0.75,
        format: SaveFormat.JPEG,
      });
      uri = manip.uri;
      mimeType = 'image/jpeg';
    } catch {
      throw new ReportBytesError('unreadable', 'Could not read that image.');
    }
  }
  const file = new File(uri);
  let exists = false;
  try {
    exists = file.exists;
  } catch {
    exists = false;
  }
  if (!exists) {
    throw new ReportBytesError('unreadable', 'Could not read that file.');
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new ReportBytesError('unreadable', 'Could not read that file.');
  }
  if (bytes.length === 0) {
    throw new ReportBytesError('unreadable', 'That file looks empty.');
  }
  if (bytes.length > MAX_REPORT_BYTES) {
    throw new ReportBytesError(
      'too_large',
      'That file is over 10MB — try a smaller file or a clearer photo.',
    );
  }
  // Anuraj: strip photo location metadata — always.
  if (looksLikeJpeg(bytes)) bytes = stripGpsFromJpeg(bytes);
  return { dataBase64: base64EncodeBytes(bytes), mimeType };
}
