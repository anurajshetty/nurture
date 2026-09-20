/**
 * Week size illustrations — 3-subject sets (Anuraj, Sept 20, 2026).
 *
 * Weeks 1-11: legacy single illustrations
 *   (assets/size/week-01.png ... week-11.png). No per-slot caption;
 *   callers fall back to the content row's size caption.
 * Weeks 12-40: approved 3-subject watercolor sets under
 *   assets/size-images/, per design/size-images/MANIFEST.json —
 *   [keeper, slot2, slot3] per week. Each slot carries its own
 *   "Your baby is the size of ..." caption from
 *   design/size-images/CAPTIONS.json; image and caption always
 *   rotate TOGETHER.
 *
 * ROTATION (Anuraj's call, Sept 20, 2026): RANDOM. Every Week-tab
 * load picks a random slot from the DISPLAYED week's 3-set
 * (displayed = completed weeks + 1). No persistence, no sequence.
 * Weeks with no art resolve to null (callers render without a
 * picture - never crash).
 *
 * Metro (including the web bundler) has no dynamic require: every
 * asset needs a static require() literal, so the table below is
 * explicit and generated from MANIFEST.json + CAPTIONS.json.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface SizeArtSlot {
  /** Metro asset id (static require). */
  image: number;
  /**
   * "Your baby is the size of ..." caption for this slot.
   * Null for the legacy weeks 1-11 (caller falls back to the
   * content row's caption).
   */
  caption: string | null;
}

const SIZE_ART: Record<number, SizeArtSlot[]> = {
  1: [
    { image: require('../../assets/size/week-01.png'), caption: null },
  ],
  2: [
    { image: require('../../assets/size/week-02.png'), caption: null },
  ],
  3: [
    { image: require('../../assets/size/week-03.png'), caption: null },
  ],
  4: [
    { image: require('../../assets/size/week-04.png'), caption: null },
  ],
  5: [
    { image: require('../../assets/size/week-05.png'), caption: null },
  ],
  6: [
    { image: require('../../assets/size/week-06.png'), caption: null },
  ],
  7: [
    { image: require('../../assets/size/week-07.png'), caption: null },
  ],
  8: [
    { image: require('../../assets/size/week-08.png'), caption: null },
  ],
  9: [
    { image: require('../../assets/size/week-09.png'), caption: null },
  ],
  10: [
    { image: require('../../assets/size/week-10.png'), caption: null },
  ],
  11: [
    { image: require('../../assets/size/week-11.png'), caption: null },
  ],
  12: [
    { image: require('../../assets/size-images/week-12/wk12-lime-1.jpg'), caption: "a lime, stem to tip" },
    { image: require('../../assets/size-images/week-12/wk12-cookie.jpg'), caption: "a warm sugar cookie, fresh from the tray" },
    { image: require('../../assets/size-images/week-12/wk12-walnut.jpg'), caption: "a plump walnut, still in its shell" },
  ],
  13: [
    { image: require('../../assets/size-images/week-13/wk13-peapod-1.jpg'), caption: "a pea pod" },
    { image: require('../../assets/size-images/week-13/wk13-mouse.jpg'), caption: "a field mouse, curled asleep" },
    { image: require('../../assets/size-images/week-13/wk13-pawn.jpg'), caption: "a wooden chess pawn, ready for its first move" },
  ],
  14: [
    { image: require('../../assets/size-images/week-14/wk14-lemon-1.jpg'), caption: "a lemon" },
    { image: require('../../assets/size-images/week-14/wk14-hamster.jpg'), caption: "a hamster with its cheek pouches fully packed" },
    { image: require('../../assets/size-images/week-14/wk14-pinecone.jpg'), caption: "a small pinecone, fresh off the branch" },
  ],
  15: [
    { image: require('../../assets/size-images/week-15/wk15-apple-1.jpg'), caption: "an apple" },
    { image: require('../../assets/size-images/week-15/wk15-donut.jpg'), caption: "a glazed donut, still a little warm" },
    { image: require('../../assets/size-images/week-15/wk15-duck.jpg'), caption: "a classic rubber duck" },
  ],
  16: [
    { image: require('../../assets/size-images/week-16/wk16-avocado-1.jpg'), caption: "an avocado" },
    { image: require('../../assets/size-images/week-16/wk16-croissant.jpg'), caption: "a buttery croissant, all flaky layers" },
    { image: require('../../assets/size-images/week-16/wk16-hedgehog.jpg'), caption: "a baby hedgehog, spines and all" },
  ],
  17: [
    { image: require('../../assets/size-images/week-17/wk17-pear-1.jpg'), caption: "a pear" },
    { image: require('../../assets/size-images/week-17/wk17-burrito.jpg'), caption: "a foil-wrapped burrito, ready to unroll" },
    { image: require('../../assets/size-images/week-17/wk17-chipmunk.jpg'), caption: "a chipmunk with its cheeks full of snacks" },
  ],
  18: [
    { image: require('../../assets/size-images/week-18/wk18-pepper-1.jpg'), caption: "a bell pepper" },
    { image: require('../../assets/size-images/week-18/wk18-pretzel.jpg'), caption: "a warm soft pretzel, extra salt" },
    { image: require('../../assets/size-images/week-18/wk18-starfish.jpg'), caption: "a starfish, arms outstretched" },
  ],
  19: [
    { image: require('../../assets/size-images/week-19/wk19-mango-1.jpg'), caption: "a mango" },
    { image: require('../../assets/size-images/week-19/wk19-sub.jpg'), caption: "a six-inch sub with all the fixings" },
    { image: require('../../assets/size-images/week-19/wk19-guineapig.jpg'), caption: "a baby guinea pig, mid-popcorn" },
  ],
  20: [
    { image: require('../../assets/size-images/week-20/wk20-banana-1.jpg'), caption: "a banana, curved and all" },
    { image: require('../../assets/size-images/week-20/wk20-frisbee.jpg'), caption: "a well-loved frisbee" },
    { image: require('../../assets/size-images/week-20/wk20-bunny.jpg'), caption: "a baby bunny, ears up" },
  ],
  21: [
    { image: require('../../assets/size-images/week-21/wk21-carrot-1.jpg'), caption: "a long carrot, pulled straight from the soil" },
    { image: require('../../assets/size-images/week-21/wk21-rollingpin.jpg'), caption: "a wooden rolling pin" },
    { image: require('../../assets/size-images/week-21/wk21-ferret.jpg'), caption: "a ferret kit, mid-zoomies" },
  ],
  22: [
    { image: require('../../assets/size-images/week-22/wk22-papaya-1.jpg'), caption: "a small papaya" },
    { image: require('../../assets/size-images/week-22/wk22-teddy.jpg'), caption: "a small teddy bear, well-hugged" },
    { image: require('../../assets/size-images/week-22/wk22-kitten.jpg'), caption: "a sleepy kitten, curled nose-to-tail" },
  ],
  23: [
    { image: require('../../assets/size-images/week-23/wk23-grapefruit-1.jpg'), caption: "a grapefruit" },
    { image: require('../../assets/size-images/week-23/wk23-penguin.jpg'), caption: "a penguin chick, all fluff" },
    { image: require('../../assets/size-images/week-23/wk23-storybook.jpg'), caption: "a hardcover bedtime storybook" },
  ],
  24: [
    { image: require('../../assets/size-images/week-24/wk24-corn-1.jpg'), caption: "an ear of corn, husk and all" },
    { image: require('../../assets/size-images/week-24/wk24-shoe.jpg'), caption: "a running shoe with its laces loose" },
    { image: require('../../assets/size-images/week-24/wk24-sloth.jpg'), caption: "a baby sloth, in no hurry whatsoever" },
  ],
  25: [
    { image: require('../../assets/size-images/week-25/wk25-rutabaga-1.jpg'), caption: "a rutabaga" },
    { image: require('../../assets/size-images/week-25/wk25-prairiedog.jpg'), caption: "a prairie dog, standing at attention" },
    { image: require('../../assets/size-images/week-25/wk25-ragdoll.jpg'), caption: "a well-loved rag doll" },
  ],
  26: [
    { image: require('../../assets/size-images/week-26/wk26-lettuce-1.jpg'), caption: "a head of lettuce" },
    { image: require('../../assets/size-images/week-26/wk26-otter.jpg'), caption: "a baby otter, mid-float" },
    { image: require('../../assets/size-images/week-26/wk26-dumptruck.jpg'), caption: "a toy dump truck, hauling blocks" },
  ],
  27: [
    { image: require('../../assets/size-images/week-27/wk27-cauliflower-1.jpg'), caption: "a cauliflower head, florets and all" },
    { image: require('../../assets/size-images/week-27/wk27-backpack.jpg'), caption: "a toddler's tiny backpack" },
    { image: require('../../assets/size-images/week-27/wk27-beaver.jpg'), caption: "a baby beaver, already gnawing" },
  ],
  28: [
    { image: require('../../assets/size-images/week-28/wk28-eggplant-1.jpg'), caption: "an eggplant" },
    { image: require('../../assets/size-images/week-28/wk28-foxkit.jpg'), caption: "a fox kit, mid-pounce" },
    { image: require('../../assets/size-images/week-28/wk28-lamp.jpg'), caption: "a tiny table lamp, glowing warm" },
  ],
  29: [
    { image: require('../../assets/size-images/week-29/wk29-squash-1.jpg'), caption: "a butternut squash" },
    { image: require('../../assets/size-images/week-29/wk29-raccoon.jpg'), caption: "a baby raccoon, washing its snacks" },
    { image: require('../../assets/size-images/week-29/wk29-pillow.jpg'), caption: "a slightly squished couch throw pillow" },
  ],
  30: [
    { image: require('../../assets/size-images/week-30/wk30-cabbage-1.jpg'), caption: "a head of cabbage" },
    { image: require('../../assets/size-images/week-30/wk30-bowlingpin.jpg'), caption: "a bowling pin, mid-spare" },
    { image: require('../../assets/size-images/week-30/wk30-redpanda.jpg'), caption: "a red panda cub, mid-snack" },
  ],
  31: [
    { image: require('../../assets/size-images/week-31/wk31-coconut-1.jpg'), caption: "a coconut, husk off" },
    { image: require('../../assets/size-images/week-31/wk31-boardgame.jpg'), caption: "a board game box, game night ready" },
    { image: require('../../assets/size-images/week-31/wk31-joey.jpg'), caption: "a joey, peeking from the pouch" },
  ],
  32: [
    { image: require('../../assets/size-images/week-32/wk32-jicama-cut-2.jpg'), caption: "a jicama" },
    { image: require('../../assets/size-images/week-32/wk32-pizzabox.jpg'), caption: "a large pizza box, still warm" },
    { image: require('../../assets/size-images/week-32/wk32-capybara.jpg'), caption: "a capybara pup, unbothered as ever" },
  ],
  33: [
    { image: require('../../assets/size-images/week-33/wk33-pineapple-plant-3.jpg'), caption: "a pineapple, crown included" },
    { image: require('../../assets/size-images/week-33/wk33-goatkid.jpg'), caption: "a goat kid, mid-bounce" },
    { image: require('../../assets/size-images/week-33/wk33-diaperbag.jpg'), caption: "a packed diaper bag \u2014 already" },
  ],
  34: [
    { image: require('../../assets/size-images/week-34/wk34-cantaloupe-vine-3.jpg'), caption: "a cantaloupe, perfectly round" },
    { image: require('../../assets/size-images/week-34/wk34-corgi.jpg'), caption: "a corgi puppy, splooting" },
    { image: require('../../assets/size-images/week-34/wk34-blanket.jpg'), caption: "a folded throw blanket" },
  ],
  35: [
    { image: require('../../assets/size-images/week-35/wk35-honeydew-slice-2.jpg'), caption: "a honeydew melon" },
    { image: require('../../assets/size-images/week-35/wk35-koala.jpg'), caption: "a koala joey, hugging the branch" },
    { image: require('../../assets/size-images/week-35/wk35-bedpillow.jpg'), caption: "a slightly lumpy bed pillow" },
  ],
  36: [
    { image: require('../../assets/size-images/week-36/wk36-romaine-1.jpg'), caption: "a romaine lettuce" },
    { image: require('../../assets/size-images/week-36/wk36-wombat.jpg'), caption: "a baby wombat, built like a loaf" },
    { image: require('../../assets/size-images/week-36/wk36-doll.jpg'), caption: "an 18-inch doll, all dressed up" },
  ],
  37: [
    { image: require('../../assets/size-images/week-37/wk37-chard-1.jpg'), caption: "a swiss chard" },
    { image: require('../../assets/size-images/week-37/wk37-porcupine.jpg'), caption: "a baby porcupine \u2014 softer than you'd think" },
    { image: require('../../assets/size-images/week-37/wk37-firelog.jpg'), caption: "a fireplace log, ready for winter" },
  ],
  38: [
    { image: require('../../assets/size-images/week-38/wk38-leek-1.jpg'), caption: "a leek" },
    { image: require('../../assets/size-images/week-38/wk38-dachshund.jpg'), caption: "a dachshund puppy in full hot-dog mode" },
    { image: require('../../assets/size-images/week-38/wk38-ukulele.jpg'), caption: "a soprano ukulele" },
  ],
  39: [
    { image: require('../../assets/size-images/week-39/wk39-watermelon-1.jpg'), caption: "a small watermelon" },
    { image: require('../../assets/size-images/week-39/wk39-sealpup.jpg'), caption: "a seal pup, mid-nap" },
    { image: require('../../assets/size-images/week-39/wk39-grocerybag.jpg'), caption: "a full grocery bag, double-bagged" },
  ],
  40: [
    { image: require('../../assets/size-images/week-40/wk40-large-watermelon-1.jpg'), caption: "a large watermelon" },
    { image: require('../../assets/size-images/week-40/wk40-lamb.jpg'), caption: "a newborn lamb, all wobble" },
    { image: require('../../assets/size-images/week-40/wk40-laundrybasket.jpg'), caption: "a laundry basket, fresh from the dryer" },
  ],
};

/**
 * Number of illustration slots for a gestational week (0 when the
 * week has no art). Weeks 1-11 have a single legacy slot; weeks
 * 12-40 have the 3-subject designer set.
 */
export function sizeArtSlotCount(week: number): number {
  const slots = SIZE_ART[week];
  return slots ? slots.length : 0;
}

/**
 * The illustration slot for a week at `index` (image + caption
 * together), or null when the week has no art or the index is out
 * of range.
 */
export function sizeArtSlot(week: number, index: number): SizeArtSlot | null {
  const slots = SIZE_ART[week];
  if (!slots || index < 0 || index >= slots.length) return null;
  return slots[index];
}

/**
 * A random slot index for a gestational week, or null when the week
 * has no art. One call = one Week-tab load's pick.
 */
export function randomSizeArtSlotIndex(week: number): number | null {
  const count = sizeArtSlotCount(week);
  if (count === 0) return null;
  return Math.floor(Math.random() * count);
}
