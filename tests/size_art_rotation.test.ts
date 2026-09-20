/**
 * Size-art per-load rotation tests (src/week/sizeArt.ts) — pure, no native
 * modules, no network.
 *
 * Rotation model (Anuraj, Sept 20, 2026): every Week-tab load advances to
 * the next of the week's variants in sequence (load 1 -> variant 1,
 * load 2 -> variant 2, load 3 -> variant 3, load 4 -> variant 1, ...).
 * The position persists under `willow.size_variant.<week>` (see
 * sizeArtVariantKey), so the sequence survives app restarts; the key
 * includes the week, so a new week starts at variant 1.
 *
 * The real asset table needs image requires, which plain node can't load,
 * so the suite stubs image extensions before importing the module: each
 * distinct required path gets a unique numeric id (like Metro asset ids),
 * and tests the pure pickers with the real table's structure (weeks 1–11
 * single legacy .png; weeks 12–40 triple bundled .jpg per
 * design/size-images/MANIFEST.json).
 *
 * Run with:
 *   npx tsc tests/size_art_rotation.test.ts src/week/sizeArt.ts \
 *     --outDir /tmp/nurture-tests-sizeart --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-sizeart/tests/size_art_rotation.test.js
 */

/* eslint-disable @typescript-eslint/no-require-imports */
declare const process: { exit(code: number): void };
declare const require: any;

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

// Stub image requires: unique numeric id per requested path, like Metro
// asset ids. Must handle both the legacy .png weeks (1–11) and the bundled
// .jpg weeks (12–40). Hook before path resolution.
const Module = require('module');
const origLoad = Module._load;
const seenPaths = new Map<string, number>();
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (
    typeof request === 'string' &&
    (request.endsWith('.png') || request.endsWith('.jpg'))
  ) {
    if (!seenPaths.has(request)) seenPaths.set(request, seenPaths.size + 1);
    return seenPaths.get(request);
  }
  return origLoad.call(this, request, parent, isMain);
};

const {
  sizeArtForWeek,
  sizeArtVariantCount,
  sizeArtVariantForWeek,
  sizeArtVariantKey,
  nextSizeArtIndex,
  parseStoredSizeArtIndex,
} = require('../src/week/sizeArt') as {
  sizeArtForWeek: (w: number) => number | null;
  sizeArtVariantCount: (w: number) => number;
  sizeArtVariantForWeek: (w: number, i: number) => number | null;
  sizeArtVariantKey: (w: number) => string;
  nextSizeArtIndex: (count: number, stored: string | null) => number;
  parseStoredSizeArtIndex: (count: number, stored: string | null) => number | null;
};

{
  // Variant counts: weeks 1–11 single legacy picture, weeks 12–40 three
  // bundled variants, unknown weeks zero.
  let countsOk = true;
  for (let w = 1; w <= 11; w++) if (sizeArtVariantCount(w) !== 1) countsOk = false;
  for (let w = 12; w <= 40; w++) if (sizeArtVariantCount(w) !== 3) countsOk = false;
  if (sizeArtVariantCount(0) !== 0) countsOk = false;
  if (sizeArtVariantCount(41) !== 0) countsOk = false;
  if (sizeArtVariantCount(99) !== 0) countsOk = false;
  ok(countsOk, 'rotation: variant counts are 1 (weeks 1-11), 3 (weeks 12-40), 0 (unknown)');
}

{
  // First load (nothing stored) shows variant 1 (index 0).
  ok(nextSizeArtIndex(3, null) === 0, 'rotation: first load -> index 0');
  ok(nextSizeArtIndex(1, null) === 0, 'rotation: single-variant week first load -> index 0');
}

{
  // Sequence advances 0 -> 1 -> 2 -> 0 -> 1 ... across loads.
  ok(nextSizeArtIndex(3, '0') === 1, 'rotation: load 2 -> index 1');
  ok(nextSizeArtIndex(3, '1') === 2, 'rotation: load 3 -> index 2');
  ok(nextSizeArtIndex(3, '2') === 0, 'rotation: load 4 wraps -> index 0');
  ok(nextSizeArtIndex(3, '0') === 1, 'rotation: load 5 -> index 1');
}

{
  // Corrupt / out-of-range stored values restart the sequence safely.
  ok(nextSizeArtIndex(3, 'banana') === 0, 'rotation: garbage stored -> index 0');
  ok(nextSizeArtIndex(3, '') === 0, 'rotation: empty stored -> index 0');
  ok(nextSizeArtIndex(3, '-1') === 0, 'rotation: negative stored -> index 0');
  ok(nextSizeArtIndex(3, '7') === 0, 'rotation: out-of-range stored -> index 0');
  ok(nextSizeArtIndex(3, '1.5') === 0, 'rotation: fractional stored -> index 0');
}

{
  // Single-variant weeks never advance.
  ok(nextSizeArtIndex(1, '0') === 0, 'rotation: single variant stays at 0');
}

{
  // Full simulated session: 5 consecutive loads of week 37 visit the
  // variants in order 1,2,3,1,2.
  const seen: Array<number | null> = [];
  let stored: string | null = null;
  for (let load = 0; load < 5; load++) {
    const idx = nextSizeArtIndex(3, stored);
    stored = String(idx);
    seen.push(sizeArtVariantForWeek(37, idx));
  }
  const distinct = new Set(seen);
  ok(distinct.size === 3, 'rotation: 5 loads visit all 3 variants');
  ok(seen[0] === seen[3], 'rotation: load 4 repeats load 1 (cycle)');
  ok(seen[1] === seen[4], 'rotation: load 5 repeats load 2 (cycle)');
  ok(seen[0] !== seen[1] && seen[1] !== seen[2], 'rotation: consecutive loads differ');
}

{
  // parseStoredSizeArtIndex: exact canonical integers parse, everything
  // else is null (so paging/peeking falls back to variant 1).
  ok(parseStoredSizeArtIndex(3, '0') === 0, 'parse: "0" -> 0');
  ok(parseStoredSizeArtIndex(3, '2') === 2, 'parse: "2" -> 2');
  ok(parseStoredSizeArtIndex(3, null) === null, 'parse: null -> null');
  ok(parseStoredSizeArtIndex(3, 'banana') === null, 'parse: garbage -> null');
  ok(parseStoredSizeArtIndex(3, '1.5') === null, 'parse: fraction -> null');
  ok(parseStoredSizeArtIndex(3, ' 1') === 1, 'parse: surrounding whitespace trimmed');
  ok(parseStoredSizeArtIndex(3, '3') === null, 'parse: out-of-range -> null');
  ok(parseStoredSizeArtIndex(0, '0') === null, 'parse: zero count -> null');
}

{
  // Paging between weeks does not advance: peeking the stored position
  // replays the last shown variant, and a fresh week starts at variant 1.
  // (Simulates the component's peek path: parse stored or fall back to 0.)
  const peekIdx = (count: number, stored: string | null) =>
    parseStoredSizeArtIndex(count, stored) ?? 0;
  ok(peekIdx(3, '1') === 1, 'peek: stored "1" replays index 1 (no advance)');
  ok(peekIdx(3, null) === 0, 'peek: fresh week starts at variant 1');
  ok(peekIdx(3, 'oops') === 0, 'peek: corrupt stored falls back to variant 1');
}

{
  // Storage keys include the week: a new week starts its own sequence.
  ok(sizeArtVariantKey(37) === 'willow.size_variant.37', 'rotation: key format');
  ok(sizeArtVariantKey(37) !== sizeArtVariantKey(38), 'rotation: keys differ per week');
  ok(
    nextSizeArtIndex(3, null) === 0,
    'rotation: fresh key (new week) starts at variant 1',
  );
}

{
  // Variant lookup wraps and handles unknown weeks.
  const first = sizeArtVariantForWeek(37, 0);
  ok(first !== null, 'rotation: week 37 index 0 resolves');
  ok(sizeArtVariantForWeek(37, 3) === first, 'rotation: index wraps to first variant');
  ok(sizeArtVariantForWeek(37, 4) === sizeArtVariantForWeek(37, 1), 'rotation: index 4 == index 1');
  ok(sizeArtVariantForWeek(99, 0) === null, 'rotation: unknown week -> null');
  ok(sizeArtVariantForWeek(5, 0) === sizeArtVariantForWeek(5, 9), 'rotation: single-variant week wraps to itself');
}

{
  // sizeArtForWeek (first-variant accessor) is unchanged: first variant
  // for known weeks, null for unknown.
  ok(sizeArtForWeek(37) === sizeArtVariantForWeek(37, 0), 'sizeArtForWeek: week 37 first variant');
  ok(sizeArtForWeek(5) !== null, 'sizeArtForWeek: legacy week resolves');
  ok(sizeArtForWeek(99) === null, 'sizeArtForWeek: unknown week -> null');
  ok(sizeArtForWeek(0) === null, 'sizeArtForWeek: week 0 -> null');
}

console.log(`=== size_art_rotation: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
