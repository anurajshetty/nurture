/**
 * Epic 2.3 deterministic tests: JPEG GPS stripping, media shape helpers,
 * and storage path building. Pure modules only — no database, no network,
 * no Expo. Run with:
 *
 *   npx tsc tests/epic2_3.test.ts src/composer/exif.ts \
 *     src/sync/mediaShape.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests23 --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests23/tests/epic2_3.test.js
 */

import { looksLikeJpeg, stripGpsFromJpeg } from '../src/composer/exif';
import {
  extensionFor,
  normalizeAttachment,
  storagePathFor,
} from '../src/sync/mediaShape';
import { bucketForKind } from '../src/lib/types';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// ---------- synthetic JPEG builders ----------

function buildExifApp1(little: boolean, withGps: boolean): number[] {
  const tiff: number[] = [];
  const u16 = (v: number) =>
    little ? tiff.push(v & 0xff, (v >> 8) & 0xff) : tiff.push((v >> 8) & 0xff, v & 0xff);
  const u32 = (v: number) =>
    little
      ? tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
      : tiff.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])); // byte order
  u16(42);
  u32(8); // IFD0 offset
  const tags: Array<[number, number, number, number]> = [
    [0x0112, 3, 1, 6], // Orientation = 6 (must survive stripping)
  ];
  if (withGps) tags.push([0x8825, 4, 1, 26]); // GPSInfo → orphaned offset
  u16(tags.length);
  for (const [tag, type, count, value] of tags) {
    u16(tag);
    u16(type);
    u32(count);
    u32(value);
  }
  u32(0); // next IFD
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const segLen = body.length + 2;
  return [0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, ...body];
}

function buildJpeg(extraSegments: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...extraSegments.flat(), 0xff, 0xd9]);
}

/** Reads IFD0 tags from the first EXIF APP1 segment; [] when absent/unparseable. */
function ifd0Tags(jpeg: Uint8Array): number[] {
  let pos = 2;
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1];
    pos += 2;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segLen = (jpeg[pos] << 8) | jpeg[pos + 1];
    if (segLen < 2 || pos + segLen > jpeg.length) break;
    if (marker === 0xe1 && segLen > 8) {
      const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
      if (sig.every((b, i) => jpeg[pos + 2 + i] === b)) {
        const t = pos + 8;
        const little = jpeg[t] === 0x49;
        const r16 = (o: number) => (little ? jpeg[o] | (jpeg[o + 1] << 8) : (jpeg[o] << 8) | jpeg[o + 1]);
        const r32 = (o: number) =>
          little
            ? jpeg[o] | (jpeg[o + 1] << 8) | (jpeg[o + 2] << 16) | (jpeg[o + 3] << 24)
            : (jpeg[o] << 24) | (jpeg[o + 1] << 16) | (jpeg[o + 2] << 8) | jpeg[o + 3];
        const ifd0 = t + r32(t + 4);
        const count = r16(ifd0);
        const tags: number[] = [];
        for (let i = 0; i < count; i++) tags.push(r16(ifd0 + 2 + i * 12));
        return tags;
      }
    }
    pos += segLen;
  }
  return [];
}

/** Reads one IFD0 entry's inline value (for the orientation check). */
function ifd0Value(jpeg: Uint8Array, tag: number): number | null {
  let pos = 2;
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1];
    pos += 2;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segLen = (jpeg[pos] << 8) | jpeg[pos + 1];
    if (segLen < 2 || pos + segLen > jpeg.length) break;
    if (marker === 0xe1 && segLen > 8) {
      const t = pos + 8;
      const little = jpeg[t] === 0x49;
      const r16 = (o: number) => (little ? jpeg[o] | (jpeg[o + 1] << 8) : (jpeg[o] << 8) | jpeg[o + 1]);
      const r32 = (o: number) =>
        little
          ? jpeg[o] | (jpeg[o + 1] << 8) | (jpeg[o + 2] << 16) | (jpeg[o + 3] << 24)
          : (jpeg[o] << 24) | (jpeg[o + 1] << 16) | (jpeg[o] << 8) | jpeg[o + 3];
      const ifd0 = t + r32(t + 4);
      const count = r16(ifd0);
      for (let i = 0; i < count; i++) {
        const e = ifd0 + 2 + i * 12;
        if (r16(e) === tag) return r32(e + 8);
      }
      return null;
    }
    pos += segLen;
  }
  return null;
}

// ---------- exif tests ----------

{
  const jpeg = buildJpeg([buildExifApp1(true, true)]);
  check('little-endian fixture has GPS + orientation', ifd0Tags(jpeg), [0x0112, 0x8825]);
  const stripped = stripGpsFromJpeg(jpeg);
  check('little-endian GPS removed', ifd0Tags(stripped), [0x0112]);
  check('little-endian orientation preserved', ifd0Value(stripped, 0x0112), 6);
  check('little-endian byte length unchanged', stripped.length, jpeg.length);
  check('little-endian still a JPEG', [stripped[0], stripped[1]], [0xff, 0xd8]);
  check('original input not mutated', ifd0Tags(jpeg), [0x0112, 0x8825]);
}

{
  const jpeg = buildJpeg([buildExifApp1(false, true)]);
  check('big-endian fixture has GPS', ifd0Tags(jpeg).includes(0x8825), true);
  const stripped = stripGpsFromJpeg(jpeg);
  check('big-endian GPS removed', ifd0Tags(stripped).includes(0x8825), false);
  check('big-endian orientation preserved', ifd0Value(stripped, 0x0112), 6);
}

{
  const jpeg = buildJpeg([buildExifApp1(true, false)]);
  const out = stripGpsFromJpeg(jpeg);
  check('EXIF without GPS returned untouched (same ref)', out === jpeg, true);
}

{
  const jpeg = buildJpeg([]);
  check('bare JPEG untouched (same ref)', stripGpsFromJpeg(jpeg) === jpeg, true);
}

{
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  check('non-JPEG untouched (same ref)', stripGpsFromJpeg(png) === png, true);
  check('looksLikeJpeg false for PNG', looksLikeJpeg(png), false);
  check('looksLikeJpeg true for JPEG', looksLikeJpeg(buildJpeg([])), true);
}

{
  // Truncated APP1 (claims more bytes than present) must not throw.
  const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0xff, 0xd9]);
  let threw = false;
  let out: Uint8Array = bad;
  try {
    out = stripGpsFromJpeg(bad);
  } catch {
    threw = true;
  }
  check('truncated segment does not throw', threw, false);
  check('truncated segment untouched', out === bad, true);
}

// ---------- mediaShape tests ----------

check('extensionFor from name', extensionFor('bump-photo.JPG'), '.jpg');
check('extensionFor from mime', extensionFor('scan', 'application/pdf'), '.pdf');
check('extensionFor unknown', extensionFor('x', undefined), '');
check('extensionFor heic mime', extensionFor('img', 'image/heic'), '.heic');

{
  const old = normalizeAttachment({
    kind: 'photo',
    uri: 'file:///cache/a.jpg',
    name: 'a.jpg',
    mimeType: 'image/jpeg',
  });
  check('old shape → local_uri', old?.local_uri, 'file:///cache/a.jpg');
  check('old shape → upload pending', old?.upload, 'pending');
  check('old shape → kind photo', old?.kind, 'photo');
  check('old shape → storage_path undefined', old?.storage_path, undefined);
}

{
  const cur = normalizeAttachment({
    id: 'a1',
    kind: 'file',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    local_uri: 'file:///doc/report.pdf',
    upload: 'done',
    storage_path: 'u1/e1/a1.pdf',
  });
  check('new shape passes through', cur, {
    id: 'a1',
    kind: 'file',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: undefined,
    local_uri: 'file:///doc/report.pdf',
    upload: 'done',
    storage_path: 'u1/e1/a1.pdf',
  });
}

check('normalizeAttachment(null) → null', normalizeAttachment(null), null);
check('normalizeAttachment(string) → null', normalizeAttachment('x'), null);
check('normalizeAttachment missing id gets fallback', (normalizeAttachment({ kind: 'file' })?.id ?? '').startsWith('att-'), true);

check(
  'storagePathFor deterministic',
  storagePathFor('user-1', 'event-2', { id: 'a3', name: 'pic.jpg' }),
  'user-1/event-2/a3.jpg',
);
check('bucketForKind photo', bucketForKind('photo'), 'photos');
check('bucketForKind file', bucketForKind('file'), 'files');

// ---------- summary ----------

console.log(`\nepic2.3: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
