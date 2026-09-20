/**
 * Size-art daily rotation tests (src/week/sizeArt.ts) — pure, no native
 * modules, no network.
 *
 * The real asset table needs image requires, which plain node can't load,
 * so the suite stubs image extensions before importing the module: each
 * distinct required path gets a unique numeric id (like Metro asset ids),
 * and tests the pure picker with synthetic variant lists plus the real
 * table's structure (weeks 1–11 single legacy .png; weeks 12–40 triple
 * bundled .jpg per design/size-images/MANIFEST.json).
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
  pickDailyVariant,
  sizeArtForWeek,
  sizeArtForWeekAndDay,
} = require('../src/week/sizeArt') as {
  pickDailyVariant: (v: readonly number[], w: number, d: string) => number | null;
  sizeArtForWeek: (w: number) => number | null;
  sizeArtForWeekAndDay: (w: number, d: string) => number | null;
};

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;

{
  // Deterministic: same week + same day always yields the same picture
  // (no flicker while scrolling / re-rendering).
  const a = pickDailyVariant([11, 22, 33], 37, '2026-09-19');
  const b = pickDailyVariant([11, 22, 33], 37, '2026-09-19');
  ok(a === b, 'rotation: same day is stable across calls');
}

{
  // Result is always one of the week's variants.
  const seen = new Set<number>();
  for (let d = 1; d <= 30; d++) {
    const v = pickDailyVariant([11, 22, 33], 37, day(d));
    ok(v === 11 || v === 22 || v === 33, `rotation: day ${day(d)} picks a real variant`);
    if (v !== null) seen.add(v);
  }
  ok(seen.size > 1, 'rotation: spreads across variants over a month');
}

{
  // Fewer than 3 pictures: rotate among whatever exists.
  const v = pickDailyVariant([11, 22], 37, '2026-09-19');
  ok(v === 11 || v === 22, 'rotation: 2-variant week picks one of the two');
}

{
  // Single picture (legacy weeks 1–11): always it.
  ok(pickDailyVariant([11], 37, '2026-09-19') === 11, 'rotation: single variant always wins');
  ok(pickDailyVariant([11], 37, '2026-09-20') === 11, 'rotation: single variant stable next day');
}

{
  // Empty list / unknown week: null, never throws (graceful fallback —
  // callers render without a picture).
  ok(pickDailyVariant([], 37, '2026-09-19') === null, 'rotation: empty list -> null');
  ok(sizeArtForWeek(99) === null, 'sizeArtForWeek: unknown week -> null');
  ok(sizeArtForWeekAndDay(99, '2026-09-19') === null, 'sizeArtForWeekAndDay: unknown week -> null');
  ok(sizeArtForWeekAndDay(0, '2026-09-19') === null, 'sizeArtForWeekAndDay: week 0 -> null');
  ok(sizeArtForWeekAndDay(41, '2026-09-19') === null, 'sizeArtForWeekAndDay: week 41 -> null');
}

{
  // Real table: weeks 1–11 keep exactly one legacy picture.
  let allSingle = true;
  for (let w = 1; w <= 11; w++) {
    if (sizeArtForWeekAndDay(w, '2026-09-19') !== sizeArtForWeek(w) || sizeArtForWeek(w) === null) {
      allSingle = false;
    }
  }
  ok(allSingle, 'real table: weeks 1..11 each resolve their single legacy picture');
}

{
  // Real table: weeks 12–40 each have exactly 3 bundled variants and the
  // daily picker rotates among them, stable within a day.
  let ok3 = true;
  for (let w = 12; w <= 40; w++) {
    const variants = new Set<number>();
    for (let d = 1; d <= 90; d++) {
      const v = sizeArtForWeekAndDay(w, day(d));
      if (v === null) {
        ok3 = false;
        break;
      }
      variants.add(v);
      // Stable all day: repeat call same day returns the same picture.
      if (sizeArtForWeekAndDay(w, day(d)) !== v) {
        ok3 = false;
        break;
      }
    }
    if (variants.size !== 3) ok3 = false;
  }
  ok(ok3, 'real table: weeks 12..40 each have 3 bundled variants, rotated stably by day');
}

{
  // Real table: sizeArtForWeek returns the first (fallback) variant and
  // the daily picker agrees with it on days that hash to index 0 — more
  // directly, the first variant is always one of the daily picks.
  let firstInRotation = true;
  for (let w = 12; w <= 40; w++) {
    const first = sizeArtForWeek(w);
    let found = false;
    for (let d = 1; d <= 90; d++) {
      if (sizeArtForWeekAndDay(w, day(d)) === first) {
        found = true;
        break;
      }
    }
    if (!found || first === null) firstInRotation = false;
  }
  ok(firstInRotation, 'real table: sizeArtForWeek first variant is reachable in daily rotation');
}

{
  // Rotation spreads across distinct days (not stuck on one picture).
  const seen = new Set<number>();
  for (let d = 1; d <= 30; d++) {
    const v = sizeArtForWeekAndDay(37, day(d));
    if (v !== null) seen.add(v);
  }
  ok(seen.size > 1, 'real table: week 37 visits more than one picture over a month');
}

console.log(`=== size_art_rotation: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
