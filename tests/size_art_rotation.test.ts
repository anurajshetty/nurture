/**
 * Size-art 3-subject random rotation tests (src/week/sizeArt.ts) — pure,
 * no native modules, no network.
 *
 * Model (Anuraj, Sept 20, 2026): RANDOM. Every Week-tab load picks a
 * random slot from the DISPLAYED week's 3-subject set (displayed =
 * completed weeks + 1). Image and caption always rotate TOGETHER: each
 * slot pairs one image with its own "Your baby is the size of ..."
 * caption from design/size-images/CAPTIONS.json. No persistence, no
 * sequence. Weeks 12-40 have 3 slots each per MANIFEST.json; weeks 1-11
 * keep a single legacy picture (caption null — caller falls back to the
 * content row); unknown weeks resolve to null.
 *
 * The real asset table needs image requires, which plain node can't load,
 * so the suite stubs image extensions before importing the module: each
 * distinct required path gets a unique numeric id (like Metro asset ids).
 * The pairing assertions cross-check the stubbed request paths against
 * the REAL design MANIFEST.json + CAPTIONS.json, so a wrong image or a
 * mismatched caption fails loudly.
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
// asset ids. Record request path -> id so pairing checks can map an id
// back to its source file.
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

interface SizeArtSlot {
  image: number;
  caption: string | null;
}

const {
  sizeArtSlotCount,
  sizeArtSlot,
  randomSizeArtSlotIndex,
} = require('../src/week/sizeArt') as {
  sizeArtSlotCount: (w: number) => number;
  sizeArtSlot: (w: number, i: number) => SizeArtSlot | null;
  randomSizeArtSlotIndex: (w: number) => number | null;
};

// Real design data — the table must match these exactly.
const MANIFEST = require('/home/hatch/workspace/app-ideas/pregnancy-tracker/design/size-images/MANIFEST.json') as Record<
  string,
  string[]
>;
const CAPTIONS = require('/home/hatch/workspace/app-ideas/pregnancy-tracker/design/size-images/CAPTIONS.json') as Record<
  string,
  string
>;

function pathForImageId(id: number): string | null {
  for (const [path, seen] of seenPaths) {
    if (seen === id) {
      const m = path.match(/assets\/size(-images)?\/(.+)$/);
      return m ? m[2] : null;
    }
  }
  return null;
}

{
  // Slot counts: weeks 1-11 single legacy slot, weeks 12-40 three slots,
  // unknown weeks zero.
  let countsOk = true;
  for (let w = 1; w <= 11; w++) if (sizeArtSlotCount(w) !== 1) countsOk = false;
  for (let w = 12; w <= 40; w++) if (sizeArtSlotCount(w) !== 3) countsOk = false;
  if (sizeArtSlotCount(0) !== 0) countsOk = false;
  if (sizeArtSlotCount(41) !== 0) countsOk = false;
  if (sizeArtSlotCount(99) !== 0) countsOk = false;
  ok(countsOk, 'slots: 1 (weeks 1-11), 3 (weeks 12-40), 0 (unknown)');
}

{
  // Image+caption pairing: every week-12..40 slot's image resolves to the
  // manifest path for that (week, slot) and its caption is exactly the
  // CAPTIONS.json entry for that path. No cross-week bleed, no stale
  // completed-week captions.
  let pairingOk = true;
  let checked = 0;
  for (let w = 12; w <= 40; w++) {
    const expected = MANIFEST[String(w)];
    if (!expected || expected.length !== 3) {
      pairingOk = false;
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const slot = sizeArtSlot(w, i);
      const manifestPath = expected[i];
      if (!slot || manifestPath === undefined) {
        pairingOk = false;
        continue;
      }
      const rel = pathForImageId(slot.image);
      if (rel !== manifestPath) pairingOk = false;
      if (slot.caption !== CAPTIONS[manifestPath]) pairingOk = false;
      checked++;
    }
  }
  ok(pairingOk && checked === 87, `pairing: all 87 slots image+caption match MANIFEST+CAPTIONS (checked ${checked})`);
}

{
  // Week 38 spot check: the three subjects are leek / dachshund / ukulele
  // with their own captions — never a week-37 chard caption.
  const subjects = [0, 1, 2].map((i) => sizeArtSlot(38, i));
  const captions = subjects.map((s) => s?.caption);
  ok(
    captions.includes('a leek') &&
      captions.includes('a dachshund puppy, stretched out long') &&
      captions.includes('a soprano ukulele'),
    'week 38: leek + dachshund + ukulele captions',
  );
  ok(
    !captions.some((c) => typeof c === 'string' && /chard/i.test(c)),
    'week 38: no swiss-chard caption bleed',
  );
  const images = subjects.map((s) => s?.image);
  ok(new Set(images).size === 3, 'week 38: three distinct images');
}

{
  // Legacy weeks 1-11: single slot, image resolves, caption null so the
  // caller falls back to the content row's caption.
  let legacyOk = true;
  for (let w = 1; w <= 11; w++) {
    const slot = sizeArtSlot(w, 0);
    if (!slot || slot.caption !== null || slot.image == null) legacyOk = false;
    const rel = slot ? pathForImageId(slot.image) : null;
    if (rel !== `week-${String(w).padStart(2, '0')}.png`) legacyOk = false;
  }
  ok(legacyOk, 'legacy: weeks 1-11 single slot, image resolves, caption null');
}

{
  // Out-of-range / unknown lookups are null (never crash).
  ok(sizeArtSlot(38, 3) === null, 'slot: index 3 on 3-slot week -> null');
  ok(sizeArtSlot(38, -1) === null, 'slot: negative index -> null');
  ok(sizeArtSlot(99, 0) === null, 'slot: unknown week -> null');
  ok(sizeArtSlot(0, 0) === null, 'slot: week 0 -> null');
  ok(sizeArtSlot(5, 1) === null, 'slot: index 1 on single-slot legacy week -> null');
}

{
  // Random pick: null for art-less weeks; in-range for the rest; over
  // many draws a 3-slot week visits all three slots.
  ok(randomSizeArtSlotIndex(99) === null, 'random: unknown week -> null');
  ok(randomSizeArtSlotIndex(0) === null, 'random: week 0 -> null');
  ok(randomSizeArtSlotIndex(41) === null, 'random: week 41 -> null');
  let rangeOk = true;
  for (let w = 12; w <= 40; w++) {
    const idx = randomSizeArtSlotIndex(w);
    if (idx === null || idx < 0 || idx > 2) rangeOk = false;
  }
  const legacy = randomSizeArtSlotIndex(5);
  if (legacy !== 0) rangeOk = false;
  ok(rangeOk, 'random: in-range indices for known weeks (0 for legacy)');
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const idx = randomSizeArtSlotIndex(38);
    if (idx !== null) seen.add(idx);
  }
  ok(seen.size === 3, `random: 60 draws visit all 3 slots of week 38 (saw ${seen.size})`);
}

{
  // The old sequential-rotation surface is gone: no KV persistence keys,
  // no next/parse helpers. (If any still existed on the module export,
  // this would catch the leftover.)
  const mod = require('../src/week/sizeArt') as Record<string, unknown>;
  const leaked = ['sizeArtVariantKey', 'nextSizeArtIndex', 'parseStoredSizeArtIndex', 'sizeArtVariantForWeek', 'sizeArtVariantCount', 'sizeArtForWeek'].filter(
    (k) => k in mod,
  );
  ok(leaked.length === 0, `rotation: old sequential API removed (leaked: ${leaked.join(',') || 'none'})`);
}

console.log(`=== size_art_3subject: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
