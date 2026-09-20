/**
 * Week size illustrations.
 *
 * Weeks 1–11: legacy single illustrations
 *   (assets/size/week-01.png … week-11.png).
 * Weeks 12–40: designer watercolor set (Sept 19, 2026) — 3 matching-style
 *   pictures per week under assets/size-images/, per
 *   design/size-images/MANIFEST.json:
 *     assets/size-images/week-NN/wkNN-<subject>-<variant>.jpg
 *   (soft watercolor, muted natural colors, warm cream paper; all JPEG
 *   q80, ≤900px — verified at bundling).
 *
 * Metro (including the web bundler) has no dynamic require: every asset
 * needs a static require() literal, so the table below is explicit.
 *
 * ROTATION (Anuraj, Sept 20, 2026): per-load rotation — every time the
 * Week tab loads, the card advances to the next of the week's pictures in
 * sequence (load 1 -> variant 1, load 2 -> variant 2, load 3 -> variant 3,
 * load 4 -> variant 1, …). The position persists in the local key/value
 * store under `willow.size_variant.<week>`, so the sequence advances
 * across app restarts too; the key includes the week, so a new week
 * always starts at variant 1. Weeks with fewer than 3 pictures rotate
 * among whatever exists; a week with no art resolves to null (callers
 * render without a picture — never crash).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const SIZE_ART: Record<number, number[]> = {
  1: [require('../../assets/size/week-01.png')],
  2: [require('../../assets/size/week-02.png')],
  3: [require('../../assets/size/week-03.png')],
  4: [require('../../assets/size/week-04.png')],
  5: [require('../../assets/size/week-05.png')],
  6: [require('../../assets/size/week-06.png')],
  7: [require('../../assets/size/week-07.png')],
  8: [require('../../assets/size/week-08.png')],
  9: [require('../../assets/size/week-09.png')],
  10: [require('../../assets/size/week-10.png')],
  11: [require('../../assets/size/week-11.png')],
  12: [
    require('../../assets/size-images/week-12/wk12-lime-1.jpg'),
    require('../../assets/size-images/week-12/wk12-lime-2.jpg'),
    require('../../assets/size-images/week-12/wk12-lime-3.jpg'),
  ],
  13: [
    require('../../assets/size-images/week-13/wk13-peapod-1.jpg'),
    require('../../assets/size-images/week-13/wk13-peapod-cut-2.jpg'),
    require('../../assets/size-images/week-13/wk13-peapod-vine-3.jpg'),
  ],
  14: [
    require('../../assets/size-images/week-14/wk14-lemon-1.jpg'),
    require('../../assets/size-images/week-14/wk14-lemon-cut-2.jpg'),
    require('../../assets/size-images/week-14/wk14-lemon-tree-3.jpg'),
  ],
  15: [
    require('../../assets/size-images/week-15/wk15-apple-1.jpg'),
    require('../../assets/size-images/week-15/wk15-apple-2.jpg'),
    require('../../assets/size-images/week-15/wk15-apple-3.jpg'),
  ],
  16: [
    require('../../assets/size-images/week-16/wk16-avocado-1.jpg'),
    require('../../assets/size-images/week-16/wk16-avocado-2.jpg'),
    require('../../assets/size-images/week-16/wk16-avocado-3.jpg'),
  ],
  17: [
    require('../../assets/size-images/week-17/wk17-pear-1.jpg'),
    require('../../assets/size-images/week-17/wk17-pear-2.jpg'),
    require('../../assets/size-images/week-17/wk17-pear-3.jpg'),
  ],
  18: [
    require('../../assets/size-images/week-18/wk18-pepper-1.jpg'),
    require('../../assets/size-images/week-18/wk18-pepper-2.jpg'),
    require('../../assets/size-images/week-18/wk18-pepper-3.jpg'),
  ],
  19: [
    require('../../assets/size-images/week-19/wk19-mango-1.jpg'),
    require('../../assets/size-images/week-19/wk19-mango-2.jpg'),
    require('../../assets/size-images/week-19/wk19-mango-3.jpg'),
  ],
  20: [
    require('../../assets/size-images/week-20/wk20-banana-1.jpg'),
    require('../../assets/size-images/week-20/wk20-banana-2.jpg'),
    require('../../assets/size-images/week-20/wk20-banana-3.jpg'),
  ],
  21: [
    require('../../assets/size-images/week-21/wk21-carrot-1.jpg'),
    require('../../assets/size-images/week-21/wk21-carrot-2.jpg'),
    require('../../assets/size-images/week-21/wk21-carrot-3.jpg'),
  ],
  22: [
    require('../../assets/size-images/week-22/wk22-papaya-1.jpg'),
    require('../../assets/size-images/week-22/wk22-papaya-2.jpg'),
    require('../../assets/size-images/week-22/wk22-papaya-3.jpg'),
  ],
  23: [
    require('../../assets/size-images/week-23/wk23-grapefruit-1.jpg'),
    require('../../assets/size-images/week-23/wk23-grapefruit-2.jpg'),
    require('../../assets/size-images/week-23/wk23-grapefruit-3.jpg'),
  ],
  24: [
    require('../../assets/size-images/week-24/wk24-corn-1.jpg'),
    require('../../assets/size-images/week-24/wk24-corn-2.jpg'),
    require('../../assets/size-images/week-24/wk24-corn-3.jpg'),
  ],
  25: [
    require('../../assets/size-images/week-25/wk25-rutabaga-1.jpg'),
    require('../../assets/size-images/week-25/wk25-rutabaga-2.jpg'),
    require('../../assets/size-images/week-25/wk25-rutabaga-3.jpg'),
  ],
  26: [
    require('../../assets/size-images/week-26/wk26-lettuce-1.jpg'),
    require('../../assets/size-images/week-26/wk26-lettuce-2.jpg'),
    require('../../assets/size-images/week-26/wk26-lettuce-3.jpg'),
  ],
  27: [
    require('../../assets/size-images/week-27/wk27-cauliflower-1.jpg'),
    require('../../assets/size-images/week-27/wk27-cauliflower-2.jpg'),
    require('../../assets/size-images/week-27/wk27-cauliflower-3.jpg'),
  ],
  28: [
    require('../../assets/size-images/week-28/wk28-eggplant-1.jpg'),
    require('../../assets/size-images/week-28/wk28-eggplant-2.jpg'),
    require('../../assets/size-images/week-28/wk28-eggplant-3.jpg'),
  ],
  29: [
    require('../../assets/size-images/week-29/wk29-squash-1.jpg'),
    require('../../assets/size-images/week-29/wk29-squash-2.jpg'),
    require('../../assets/size-images/week-29/wk29-squash-3.jpg'),
  ],
  30: [
    require('../../assets/size-images/week-30/wk30-cabbage-1.jpg'),
    require('../../assets/size-images/week-30/wk30-cabbage-2.jpg'),
    require('../../assets/size-images/week-30/wk30-cabbage-3.jpg'),
  ],
  31: [
    require('../../assets/size-images/week-31/wk31-coconut-1.jpg'),
    require('../../assets/size-images/week-31/wk31-coconut-2.jpg'),
    require('../../assets/size-images/week-31/wk31-coconut-3.jpg'),
  ],
  32: [
    require('../../assets/size-images/week-32/wk32-jicama-cut-2.jpg'),
    require('../../assets/size-images/week-32/wk32-jicama-leaves-3.jpg'),
    require('../../assets/size-images/week-32/wk32-jicama-whole-1.jpg'),
  ],
  33: [
    require('../../assets/size-images/week-33/wk33-pineapple-plant-3.jpg'),
    require('../../assets/size-images/week-33/wk33-pineapple-slice-2.jpg'),
    require('../../assets/size-images/week-33/wk33-pineapple-whole-1.jpg'),
  ],
  34: [
    require('../../assets/size-images/week-34/wk34-cantaloupe-vine-3.jpg'),
    require('../../assets/size-images/week-34/wk34-cantaloupe-wedge-2.jpg'),
    require('../../assets/size-images/week-34/wk34-cantaloupe-whole-1.jpg'),
  ],
  35: [
    require('../../assets/size-images/week-35/wk35-honeydew-slice-2.jpg'),
    require('../../assets/size-images/week-35/wk35-honeydew-vine-3.jpg'),
    require('../../assets/size-images/week-35/wk35-honeydew-whole-1.jpg'),
  ],
  36: [
    require('../../assets/size-images/week-36/wk36-romaine-1.jpg'),
    require('../../assets/size-images/week-36/wk36-romaine-cut-2.jpg'),
    require('../../assets/size-images/week-36/wk36-romaine-plant-3.jpg'),
  ],
  37: [
    require('../../assets/size-images/week-37/wk37-chard-1.jpg'),
    require('../../assets/size-images/week-37/wk37-chard-cut-2.jpg'),
    require('../../assets/size-images/week-37/wk37-chard-plant-3.jpg'),
  ],
  38: [
    require('../../assets/size-images/week-38/wk38-leek-1.jpg'),
    require('../../assets/size-images/week-38/wk38-leek-cut-2.jpg'),
    require('../../assets/size-images/week-38/wk38-leek-plant-3.jpg'),
  ],
  39: [
    require('../../assets/size-images/week-39/wk39-watermelon-1.jpg'),
    require('../../assets/size-images/week-39/wk39-watermelon-cut-2.jpg'),
    require('../../assets/size-images/week-39/wk39-watermelon-vine-3.jpg'),
  ],
  40: [
    require('../../assets/size-images/week-40/wk40-large-watermelon-1.jpg'),
    require('../../assets/size-images/week-40/wk40-large-watermelon-cut-2.jpg'),
    require('../../assets/size-images/week-40/wk40-large-watermelon-vine-3.jpg'),
  ],
};

/**
 * Illustration asset for a gestational week — the first variant, or null
 * when the week has no art (outside 1–40). Kept for callers that don't
 * need rotation.
 */
export function sizeArtForWeek(week: number): number | null {
  const variants = SIZE_ART[week];
  return variants && variants.length > 0 ? variants[0] : null;
}

/**
 * Number of bundled variants for a gestational week (0 when the week has
 * no art). Weeks 1–11 have a single legacy picture; weeks 12–40 have the
 * 3-variant designer watercolor set.
 */
export function sizeArtVariantCount(week: number): number {
  const variants = SIZE_ART[week];
  return variants ? variants.length : 0;
}

/**
 * The variant asset for a week at `index`, wrapping around the week's
 * variant list (so index 3 on a 3-variant week yields the first picture).
 * Null when the week has no art.
 */
export function sizeArtVariantForWeek(week: number, index: number): number | null {
  const variants = SIZE_ART[week];
  if (!variants || variants.length === 0) return null;
  const idx = ((index % variants.length) + variants.length) % variants.length;
  return variants[idx];
}

/**
 * Storage key for the per-load rotation position. The key includes the
 * week, so each week has its own sequence and a new week always starts
 * at variant 1.
 */
export function sizeArtVariantKey(week: number): string {
  return `willow.size_variant.${week}`;
}

/**
 * Parses a stored rotation value; null when absent or corrupt.
 * Only an exact canonical integer continues the sequence.
 */
export function parseStoredSizeArtIndex(
  count: number,
  storedRaw: string | null,
): number | null {
  if (count <= 0 || storedRaw === null) return null;
  const trimmed = storedRaw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (Number.isInteger(n) && n >= 0 && n < count && String(n) === trimmed) {
    return n;
  }
  return null;
}

/**
 * Pure next-index step for the per-load rotation: given the raw stored
 * value (or null when never stored), returns the variant index to show
 * on this load. Unparseable or out-of-range stored values restart the
 * sequence at the first variant.
 */
export function nextSizeArtIndex(count: number, storedRaw: string | null): number {
  if (count <= 0) return 0;
  const prev = parseStoredSizeArtIndex(count, storedRaw) ?? -1;
  return (prev + 1) % count;
}
