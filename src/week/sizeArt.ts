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
 * ROTATION (Anuraj, Sept 19, 2026): one picture per week per day —
 * pickDailyVariant() selects a variant deterministically from the
 * YYYY-MM-DD date (date-seeded djb2 hash), so the card never flickers
 * while scrolling and re-picks automatically on a new day. Weeks with
 * fewer than 3 pictures rotate among whatever exists; a week with no
 * art resolves to null (callers render without a picture — never crash).
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
 * djb2 string hash — deterministic, dependency-free. Used only to spread
 * days across a week's variants.
 */
function hashDayKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Pure daily pick from a variant list: deterministic on (week, dayKey),
 * so the same day always yields the same picture (no flicker while
 * scrolling) and a new day re-picks. Null on an empty list.
 */
export function pickDailyVariant(
  variants: readonly number[],
  week: number,
  dayKey: string,
): number | null {
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0];
  const idx = hashDayKey(`${week}:${dayKey}`) % variants.length;
  return variants[idx];
}

/**
 * Illustration asset for a gestational week on a given day.
 *
 * Picks one of the week's pictures deterministically from `dayKey`
 * (a YYYY-MM-DD date string): the same day always yields the same
 * picture, so the card never flickers while scrolling, and a new day
 * re-picks automatically. With a single picture (the current state
 * until the designer delivers variants) it always returns that one.
 * Null when the week has no art.
 */
export function sizeArtForWeekAndDay(week: number, dayKey: string): number | null {
  const variants = SIZE_ART[week];
  if (!variants) return null;
  return pickDailyVariant(variants, week, dayKey);
}
