/**
 * Week size illustrations (assets/size/week-01.png … week-40.png).
 *
 * Metro (including the web bundler) has no dynamic require: every asset
 * needs a static require() literal, so the table below is explicit.
 * Images are pre-downscaled to 1024px max — never ship the 1600px sources.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const SIZE_ART: Record<number, number> = {
  1: require('../../assets/size/week-01.png'),
  2: require('../../assets/size/week-02.png'),
  3: require('../../assets/size/week-03.png'),
  4: require('../../assets/size/week-04.png'),
  5: require('../../assets/size/week-05.png'),
  6: require('../../assets/size/week-06.png'),
  7: require('../../assets/size/week-07.png'),
  8: require('../../assets/size/week-08.png'),
  9: require('../../assets/size/week-09.png'),
  10: require('../../assets/size/week-10.png'),
  11: require('../../assets/size/week-11.png'),
  12: require('../../assets/size/week-12.png'),
  13: require('../../assets/size/week-13.png'),
  14: require('../../assets/size/week-14.png'),
  15: require('../../assets/size/week-15.png'),
  16: require('../../assets/size/week-16.png'),
  17: require('../../assets/size/week-17.png'),
  18: require('../../assets/size/week-18.png'),
  19: require('../../assets/size/week-19.png'),
  20: require('../../assets/size/week-20.png'),
  21: require('../../assets/size/week-21.png'),
  22: require('../../assets/size/week-22.png'),
  23: require('../../assets/size/week-23.png'),
  24: require('../../assets/size/week-24.png'),
  25: require('../../assets/size/week-25.png'),
  26: require('../../assets/size/week-26.png'),
  27: require('../../assets/size/week-27.png'),
  28: require('../../assets/size/week-28.png'),
  29: require('../../assets/size/week-29.png'),
  30: require('../../assets/size/week-30.png'),
  31: require('../../assets/size/week-31.png'),
  32: require('../../assets/size/week-32.png'),
  33: require('../../assets/size/week-33.png'),
  34: require('../../assets/size/week-34.png'),
  35: require('../../assets/size/week-35.png'),
  36: require('../../assets/size/week-36.png'),
  37: require('../../assets/size/week-37.png'),
  38: require('../../assets/size/week-38.png'),
  39: require('../../assets/size/week-39.png'),
  40: require('../../assets/size/week-40.png'),
};

/**
 * Illustration asset for a gestational week, or null when the week has no
 * art (outside 1–40).
 */
export function sizeArtForWeek(week: number): number | null {
  return SIZE_ART[week] ?? null;
}
