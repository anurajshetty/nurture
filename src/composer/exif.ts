/**
 * JPEG GPS metadata stripper (Epic 2.3).
 *
 * Anuraj's decision: strip photo location (EXIF GPS) metadata at upload
 * time — always. This module surgically removes ONLY the GPS IFD reference
 * (tag 0x8825) from a JPEG's EXIF APP1 segment, leaving everything else —
 * including the orientation tag, so photos never rotate — intact.
 *
 * Pure functions over Uint8Array: no filesystem, no network, fully
 * unit-testable. Non-JPEG input, JPEGs without EXIF, EXIF without GPS, and
 * malformed segments are returned untouched.
 */

const EXIF_SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const TAG_GPS_INFO = 0x8825;
const TIFF_MAGIC = 42;

function readU16(b: Uint8Array, off: number, little: boolean): number {
  return little ? b[off] | (b[off + 1] << 8) : (b[off] << 8) | b[off + 1];
}

function writeU16(b: Uint8Array, off: number, value: number, little: boolean): void {
  if (little) {
    b[off] = value & 0xff;
    b[off + 1] = (value >> 8) & 0xff;
  } else {
    b[off] = (value >> 8) & 0xff;
    b[off + 1] = value & 0xff;
  }
}

function readU32(b: Uint8Array, off: number, little: boolean): number {
  return little
    ? b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)
    : (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
}

/**
 * Removes the GPS IFD entry from one TIFF block in place.
 * `tiffStart` points at the byte-order mark; `tiffLen` bounds the block.
 * Returns true when an entry was removed.
 */
function removeGpsEntry(b: Uint8Array, tiffStart: number, tiffLen: number): boolean {
  if (tiffLen < 8) return false;
  const o0 = b[tiffStart];
  const o1 = b[tiffStart + 1];
  const little = o0 === 0x49 && o1 === 0x49;
  const big = o0 === 0x4d && o1 === 0x4d;
  if (!little && !big) return false;
  if (readU16(b, tiffStart + 2, little) !== TIFF_MAGIC) return false;

  const ifd0 = tiffStart + readU32(b, tiffStart + 4, little);
  if (ifd0 < tiffStart || ifd0 + 2 > tiffStart + tiffLen) return false;
  const count = readU16(b, ifd0, little);
  const entriesStart = ifd0 + 2;
  const entriesEnd = entriesStart + count * 12;
  if (count < 0 || entriesEnd > tiffStart + tiffLen) return false;

  let gpsAt = -1;
  for (let i = 0; i < count; i++) {
    if (readU16(b, entriesStart + i * 12, little) === TAG_GPS_INFO) {
      gpsAt = entriesStart + i * 12;
      break;
    }
  }
  if (gpsAt < 0) return false;

  // Shift later entries back over the GPS entry, drop the count by one,
  // and zero the freed 12 bytes at the tail. The orphaned GPS IFD bytes
  // stay in the segment but are unreachable — harmless.
  b.copyWithin(gpsAt, gpsAt + 12, entriesEnd);
  b.fill(0, entriesEnd - 12, entriesEnd);
  writeU16(b, ifd0, count - 1, little);
  return true;
}

/**
 * Returns JPEG bytes with EXIF GPS removed. The input is never mutated —
 * a copy is made only when a GPS entry is actually removed; otherwise the
 * original buffer is returned as-is.
 */
export function stripGpsFromJpeg(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const out = new Uint8Array(input);
  let changed = false;
  let pos = 2;
  while (pos + 4 <= out.length) {
    if (out[pos] !== 0xff) break;
    const marker = out[pos + 1];
    pos += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue; // standalone markers carry no length
    }
    if (pos + 2 > out.length) break;
    const segLen = (out[pos] << 8) | out[pos + 1];
    if (segLen < 2 || pos + segLen > out.length) break;
    if (marker === 0xe1 && segLen >= 8) {
      let isExif = true;
      for (let i = 0; i < EXIF_SIG.length; i++) {
        if (out[pos + 2 + i] !== EXIF_SIG[i]) {
          isExif = false;
          break;
        }
      }
      if (isExif && removeGpsEntry(out, pos + 2 + EXIF_SIG.length, segLen - 2 - EXIF_SIG.length)) {
        changed = true;
      }
    }
    pos += segLen;
  }
  return changed ? out : input;
}

/** True when the bytes look like a JPEG (used to decide whether to strip). */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
