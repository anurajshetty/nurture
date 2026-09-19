/**
 * On-device delight content for the enriched Home briefing.
 *
 * The Home tab shows the 4 routine briefing cards first (trust), then a
 * quiet "A little wonder" divider, then 3 delight cards: "Did you know?"
 * + "How big is {name}?" every visit, plus one rotating card among
 * For the partner / Traditions / Story of the week / Your baby's name /
 * Milestone ahead.
 *
 * The {Name}/{name} tokens in curated copy are substituted on-device with
 * the baby's name when one is set (onboarding/You tab), or "Your baby" /
 * "your baby" otherwise (see withBabyName in ./context.ts). The tokens —
 * never the real name — are what the engine and phrase pipeline see, so a
 * name can never leave the device. The "Your baby's name" rotating card
 * only appears when a name has been given; it celebrates the choice and
 * never invents a meaning.
 *
 * Content rules (hard):
 * - Every delight fact is hand-curated and traces to established sources
 *   (ACOG / Mayo / NHS patient pages, standard growth charts, standard name
 *   dictionaries). When in doubt, the fact is cut — nothing is invented.
 * - General information only. Never diagnosis, triage, symptom
 *   interpretation, prescriptive advice, or scary statistics. Wonder-first,
 *   never scary. Medical meaning stays with the doctor.
 * - Selection is deterministic and on-device (no network, works offline).
 *   The rotating slot's per-kind cursor is persisted in the app kv store so
 *   repeat visits feel fresh without repeats.
 * - The server briefing contract (./types.ts) is untouched: delight derives
 *   from the briefing's gestational week.
 */

import { colors } from '../theme/tokens';

/** Delight card kinds. 'fact' and 'size' show every visit; the other five rotate. */
export type DelightKind =
  | 'fact'
  | 'size'
  | 'partner'
  | 'tradition'
  | 'story'
  | 'name'
  | 'milestone';

/** One run of text inside a paragraph; bold marks the warm emphasis. */
export interface DelightRun {
  text: string;
  bold?: boolean;
}

/** Body = paragraphs of runs. Rendered with the same warmth as routine cards. */
export type DelightBody = DelightRun[][];

/** One delight card, ready to render as a compact expandable row. */
export interface DelightCard {
  /** Stable within a day, e.g. 'delight-card-fact', 'delight-card-size', 'delight-card-rotating'. */
  id: string;
  kind: DelightKind;
  /** Row title, e.g. "Did you know?" */
  title: string;
  /** One-line collapsed preview (ellipsis-truncated by the row). */
  preview: string;
  body: DelightBody;
  /** Tinted icon tile. */
  tint: string;
  /** Text glyph on the tile (dingbat, renders as text on all platforms). */
  glyph: string;
  glyphColor: string;
}

/** Minimal key/value surface for the rotation state (same shape as ./cache.ts KvStore). */
export interface DelightStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** The five kinds that take turns in the third delight slot. */
export type RotatingKind = 'partner' | 'tradition' | 'story' | 'name' | 'milestone';

/** Rotation order for the third delight slot, by day of year. */
export const ROTATION_ORDER: RotatingKind[] = [
  'partner',
  'tradition',
  'story',
  'name',
  'milestone',
];

/** Teal accents for the milestone card (mockup); tokens carry the rest. */
const TEAL_TINT = '#E2F0EF';
const TEAL_DEEP = '#5F9E9B';
const LILAC_TINT = '#EFEAF7';
const GOLD_TINT = '#FAF3DF';
const GOLD_DEEP = '#96771B';
const BLUE_DEEP = '#4E7FA3';

const TILES: Record<DelightKind, { tint: string; glyph: string; glyphColor: string }> = {
  fact: { tint: GOLD_TINT, glyph: '✦', glyphColor: GOLD_DEEP },
  size: { tint: colors.blueTint, glyph: '◉', glyphColor: BLUE_DEEP },
  partner: { tint: colors.blush, glyph: '♥', glyphColor: colors.coralDeep },
  tradition: { tint: LILAC_TINT, glyph: '❀', glyphColor: colors.lilac },
  story: { tint: colors.sageTint, glyph: '✎', glyphColor: colors.sageDeep },
  name: { tint: GOLD_TINT, glyph: '✿', glyphColor: GOLD_DEEP },
  milestone: { tint: TEAL_TINT, glyph: '☀', glyphColor: TEAL_DEEP },
};

// ---------------------------------------------------------------------------
// Size bank — one entry per gestational week (12–40).
// Measurements are the standard approximate figures ("about"); the
// comparison object is the delight. Weeks outside 12–40 clamp.
// ---------------------------------------------------------------------------

interface SizeEntry {
  /** The familiar anchor, e.g. "an eggplant". */
  staple: string;
  /** The delightful comparison, e.g. "a regulation bowling pin". */
  delight: string;
  length: string;
  weight: string;
}

export const SIZE_BY_WEEK: Record<number, SizeEntry> = {
  12: { staple: 'a lime', delight: 'a lime, stem to tip', length: 'about 2 inches', weight: 'about ½ oz' },
  13: { staple: 'a lemon', delight: 'a lemon — or a AA battery stood on end', length: 'about 2.9 inches', weight: 'about 0.8 oz' },
  14: { staple: 'a peach', delight: 'a peach — or a billiard ball', length: 'about 3.4 inches', weight: 'about 1.5 oz' },
  15: { staple: 'an apple', delight: 'an apple — or a tennis ball', length: 'about 4 inches', weight: 'about 2.5 oz' },
  16: { staple: 'an avocado', delight: 'an avocado — or a bar of soap', length: 'about 4.6 inches', weight: 'about 3.5 oz' },
  17: { staple: 'a pear', delight: 'a pear — or a paperback novel standing up', length: 'about 5.1 inches', weight: 'about 5 oz' },
  18: { staple: 'a bell pepper', delight: 'a bell pepper — or a computer mouse', length: 'about 5.6 inches', weight: 'about 6.7 oz' },
  19: { staple: 'a mango', delight: 'a mango — or a tall coffee mug', length: 'about 6 inches', weight: 'about 8.5 oz' },
  20: { staple: 'a banana', delight: 'a banana, curved and all', length: 'about 10 inches', weight: 'about 10.5 oz' },
  21: { staple: 'a carrot', delight: 'a long carrot pulled straight from the soil', length: 'about 10.5 inches', weight: 'about 12.3 oz' },
  22: { staple: 'a small papaya', delight: 'a small papaya — or a plush rabbit', length: 'about 11 inches', weight: 'about 15 oz' },
  23: { staple: 'a grapefruit', delight: 'a grapefruit — or a softball', length: 'about 11.4 inches', weight: 'about 1.1 lb' },
  24: { staple: 'an ear of corn', delight: 'an ear of corn, husk and all', length: 'about 11.8 inches', weight: 'about 1.3 lb' },
  25: { staple: 'a rutabaga', delight: 'a rutabaga — about as long as a paperback novel', length: 'about 13.6 inches', weight: 'about 1.5 lb' },
  26: { staple: 'a bunch of scallions', delight: 'a bundle of scallions from the market', length: 'about 14 inches', weight: 'about 1.7 lb' },
  27: { staple: 'a cauliflower', delight: 'a cauliflower head, florets and all', length: 'about 14.4 inches', weight: 'about 2 lb' },
  28: { staple: 'an eggplant', delight: 'a regulation bowling pin', length: 'about 14.8 inches', weight: 'about 2.2 lb' },
  29: { staple: 'a butternut squash', delight: 'a butternut squash — or a small ukulele', length: 'about 15.2 inches', weight: 'about 2.5 lb' },
  30: { staple: 'a large cucumber', delight: 'a large cucumber — wand-sized', length: 'about 15.7 inches', weight: 'about 2.9 lb' },
  31: { staple: 'a coconut', delight: 'a coconut, husk off', length: 'about 16.2 inches', weight: 'about 3.3 lb' },
  32: { staple: 'a jicama', delight: 'a jicama — or a small skateboard deck', length: 'about 16.7 inches', weight: 'about 3.75 lb' },
  33: { staple: 'a pineapple', delight: 'a pineapple, crown included', length: 'about 17.2 inches', weight: 'about 4.2 lb' },
  34: { staple: 'a cantaloupe', delight: 'a cantaloupe, perfectly round', length: 'about 17.7 inches', weight: 'about 4.7 lb' },
  35: { staple: 'a honeydew melon', delight: 'a honeydew melon', length: 'about 18.2 inches', weight: 'about 5.25 lb' },
  36: { staple: 'a romaine heart', delight: 'a romaine heart — or a trombone slide', length: 'about 18.7 inches', weight: 'about 5.75 lb' },
  37: { staple: 'a bundle of leeks', delight: 'a bundle of leeks from the market', length: 'about 19.1 inches', weight: 'about 6.3 lb' },
  38: { staple: 'a mini watermelon', delight: 'a mini watermelon', length: 'about 19.6 inches', weight: 'about 6.8 lb' },
  39: { staple: 'a small pumpkin', delight: 'a small pumpkin — harvest-season ready', length: 'about 20 inches', weight: 'about 7.3 lb' },
  40: { staple: 'a small watermelon', delight: 'a small watermelon — the classic, at last', length: 'about 20.2 inches', weight: 'about 7.6 lb' },
};

export const MIN_SIZE_WEEK = 12;
export const MAX_SIZE_WEEK = 40;

// ---------------------------------------------------------------------------
// Fact bank — "Did you know?" Week-anchored where noted; entries without a
// week range are evergreen. All from well-established findings (fetal
// hearing 24–27 wks, taste from early weeks, eyes opening ~26–28 wks,
// newborn voice-recognition studies, standard anatomy).
// ---------------------------------------------------------------------------

interface FactEntry {
  /** Stable id, referenced by matrix rows' delight.factIds. */
  id: string;
  /** Inclusive week range this fact belongs to; omit for evergreen. */
  weeks?: [number, number];
  preview: string;
  body: DelightBody;
}

export const FACTS: FactEntry[] = [
  {
    id: 'flavors-amniotic',
    weeks: [12, 40],
    preview: 'Flavors from your lunch drift into the amniotic fluid…',
    body: [
      [
        { text: 'Flavors from your lunch — garlic, vanilla, carrot — drift into the amniotic fluid, and {name} has been tasting them for weeks. ' },
        { text: "Tonight's dinner is her first restaurant.", bold: true },
      ],
    ],
  },
  {
    id: 'voice-recognition',
    weeks: [28, 40],
    preview: 'She already knows your voice from a stranger’s…',
    body: [
      [
        { text: '{Name} can already tell your voice apart from a stranger’s. ' },
        { text: 'Newborns recognize the rhythm of the language they heard in the womb — she has been listening for weeks.', bold: true },
      ],
    ],
  },
  {
    id: 'eyes-open-close',
    weeks: [26, 40],
    preview: 'Her eyes can open and close now…',
    body: [
      [
        { text: 'Her eyes can open and close now — and bright light through the belly wall may get a reaction. ' },
        { text: 'Try shining a soft flashlight and saying hello.', bold: true },
      ],
    ],
  },
  {
    id: 'sleep-cycles',
    weeks: [28, 40],
    preview: 'Sleep is settling into cycles…',
    body: [
      [
        { text: 'Sleep is settling into cycles — those active and quiet stretches are starting to have a rhythm of their own. ' },
        { text: 'You may already be able to tell the party hours from the nap hours.', bold: true },
      ],
    ],
  },
  {
    id: 'hiccups',
    weeks: [12, 40],
    preview: 'Those tiny rhythmic jerks? Usually hiccups…',
    body: [
      [
        { text: 'Those tiny rhythmic jerks are usually hiccups — she has been practicing them for weeks. ' },
        { text: 'Nobody knows exactly why babies hiccup in the womb; the leading theory is that it exercises the breathing muscles.', bold: true },
      ],
    ],
  },
  {
    id: 'fingerprints',
    weeks: [20, 40],
    preview: 'Her fingerprints are already one of a kind…',
    body: [
      [
        { text: 'Her fingerprints are forming — the swirls on her fingertips are already one of a kind. ' },
        { text: 'No one else in history will ever have this exact pattern.', bold: true },
      ],
    ],
  },
  {
    id: 'heartbeat-fast',
    weeks: [12, 40],
    preview: 'Her heart beats about twice as fast as yours…',
    body: [
      [
        { text: 'Her heart beats about twice as fast as yours — roughly 120 to 160 times a minute. ' },
        { text: 'That galloping rhythm is the sound most parents remember forever.', bold: true },
      ],
    ],
  },
  {
    id: 'swallowing-practice',
    weeks: [12, 40],
    preview: 'She swallows a little of her world every day…',
    body: [
      [
        { text: 'She swallows amniotic fluid every day — it’s how her digestion is rehearsing for the real thing. ' },
        { text: 'Practice, practice, practice.', bold: true },
      ],
    ],
  },
  {
    id: 'vernix',
    weeks: [12, 40],
    preview: 'She arrives with her own protective coating…',
    body: [
      [
        { text: 'A creamy coating called vernix protects her skin in the fluid — it’s why newborns sometimes arrive looking a little frosted. ' },
        { text: 'Nature’s own moisturizer.', bold: true },
      ],
    ],
  },
  {
    id: 'brain-folds',
    weeks: [24, 40],
    preview: 'Her brain is folding itself into shape…',
    body: [
      [
        { text: 'Her brain is developing its folds and grooves now — more surface area for all that wiring. ' },
        { text: 'The most complex object in the known universe, under construction.', bold: true },
      ],
    ],
  },
  {
    id: 'light-turn',
    weeks: [32, 40],
    preview: 'She may turn toward bright light…',
    body: [
      [
        { text: 'By now she may turn toward bright light — researchers have watched it happen on scans. ' },
        { text: 'Her world is dark, but she’s already curious about the edges of it.', bold: true },
      ],
    ],
  },
  {
    id: 'startle-reflex',
    weeks: [12, 40],
    preview: 'Loud sounds can make her startle…',
    body: [
      [
        { text: 'Loud sounds can make her startle — the reflex is wired up and working. ' },
        { text: 'If a door slams and you feel a jump, that was a tiny person with opinions.', bold: true },
      ],
    ],
  },
  {
    id: 'rem-sleep',
    weeks: [20, 40],
    preview: 'Scans have caught what looks like REM sleep…',
    body: [
      [
        { text: 'Scans have caught what looks like REM sleep in there — the same sleep stage where adults dream. ' },
        { text: 'Whether that means dreaming, nobody can say — but her brain is clearly rehearsing something.', bold: true },
      ],
    ],
  },
  {
    id: 'cord-slack',
    weeks: [12, 40],
    preview: 'Her cord has plenty of slack for somersaults…',
    body: [
      [
        { text: 'Her umbilical cord is about as long as she is — with plenty of slack for somersaults. ' },
        { text: 'It’s her lifeline, her jungle gym, and her favorite toy, all in one.', bold: true },
      ],
    ],
  },
  {
    id: 'amniotic-pool',
    weeks: [12, 40],
    preview: 'She floats in her own private pool…',
    body: [
      [
        { text: 'She floats in about a quart of amniotic fluid — her own private pool, kept at perfect body temperature. ' },
        { text: 'It cushions every tumble and carries every flavor.', bold: true },
      ],
    ],
  },
  {
    id: 'crying-practice',
    weeks: [12, 40],
    preview: 'Ultrasound has caught her practicing crying faces…',
    body: [
      [
        { text: 'Researchers filming with ultrasound have watched babies practice crying faces — brows furrowed, mouth open. ' },
        { text: 'Full dress rehearsal, no sound.', bold: true },
      ],
    ],
  },
  {
    id: 'skull-soft',
    weeks: [12, 40],
    preview: 'Her skull stays soft on purpose…',
    body: [
      [
        { text: 'Her bones are hardening from soft cartilage — except the skull, which stays flexible for the journey out. ' },
        { text: 'The plates won’t fully fuse until well after birth.', bold: true },
      ],
    ],
  },
  {
    id: 'surfactant',
    weeks: [34, 40],
    preview: 'Her lungs are making something soapy…',
    body: [
      [
        { text: 'Her lungs are making surfactant now — a soapy substance that will help them inflate with her first breath. ' },
        { text: 'One of the last systems to finish, right on schedule.', bold: true },
      ],
    ],
  },
  {
    id: 'placenta',
    weeks: [12, 40],
    preview: 'The placenta grew right alongside her…',
    body: [
      [
        { text: 'The placenta grew right alongside her — part pantry, part post office, all temporary. ' },
        { text: 'It’s the only organ the body builds from scratch and then retires.', bold: true },
      ],
    ],
  },
  {
    id: 'lanugo',
    weeks: [12, 24],
    preview: 'She’s wearing a fine downy coat…',
    body: [
      [
        { text: 'A fine down called lanugo covers her skin right now — most of it sheds before she arrives. ' },
        { text: 'A first wardrobe, worn once and returned.', bold: true },
      ],
    ],
  },
  {
    id: 'head-down',
    weeks: [36, 40],
    preview: 'Most babies settle into launch position…',
    body: [
      [
        { text: 'Most babies settle head-down around now — the classic launch position. ' },
        { text: 'If she’s still breech, she has company: plenty of babies flip fashionably late.', bold: true },
      ],
    ],
  },
  {
    id: 'blood-type-bones',
    weeks: [12, 40],
    preview: 'She already has her own blood type…',
    body: [
      [
        { text: 'She already has her own blood type — and about 300 bones, some of which will fuse as she grows. ' },
        { text: 'Adults make do with 206.', bold: true },
      ],
    ],
  },
];

// ---------------------------------------------------------------------------
// Partner tips — "For the partner". One per week (12–40), warm and neutral:
// acts of service and emotional presence, never preachy, never advice
// about her body.
// ---------------------------------------------------------------------------

export const PARTNER_TIPS: Record<number, { preview: string; body: DelightBody }> = {
  12: {
    preview: 'Learn the anti-nausea roster…',
    body: [[{ text: 'First-trimester nausea has a roster — the crackers, the ginger chews, the thing that worked on Tuesday. ' }, { text: 'Learn it, restock it, never let it run out.', bold: true }]],
  },
  13: {
    preview: 'Take one invisible chore off her plate…',
    body: [[{ text: 'Energy is still low. ' }, { text: 'Take one invisible chore off her plate today — the one she always notices but never mentions.', bold: true }]],
  },
  14: {
    preview: 'Plan something small and lovely…',
    body: [[{ text: 'The second trimester is often the sweet spot. ' }, { text: 'Plan something small and lovely — a sunset walk, her favorite takeout, nowhere fancy.', bold: true }]],
  },
  15: {
    preview: 'Her sense of smell may be superhuman…',
    body: [[{ text: 'Her sense of smell may still be superhuman. ' }, { text: 'Cook the strong-smelling stuff when she’s out — or not at all.', bold: true }]],
  },
  16: {
    preview: 'Put the next appointment in your calendar…',
    body: [[{ text: 'Ask what the next appointment is and put it in your calendar. ' }, { text: 'Showing up informed is a love language.', bold: true }]],
  },
  17: {
    preview: 'Back rubs are about to become currency…',
    body: [[{ text: 'Back rubs are about to become currency. ' }, { text: 'Learn the lower-back press: thumbs on either side of the spine, slow circles.', bold: true }]],
  },
  18: {
    preview: 'When she grabs your hand to feel — drop everything…',
    body: [[{ text: 'She might feel the first flutters soon. ' }, { text: 'When she grabs your hand to feel, drop everything. That moment only happens once.', bold: true }]],
  },
  19: {
    preview: 'Become the unofficial pillow engineer…',
    body: [[{ text: 'Sleep positions are getting strategic. ' }, { text: 'Become the unofficial pillow engineer — one between the knees works wonders.', bold: true }]],
  },
  20: {
    preview: 'Halfway there — write her a note…',
    body: [[{ text: 'Halfway there. ' }, { text: 'Write her a short note about what you’re most looking forward to — she’ll keep it forever.', bold: true }]],
  },
  21: {
    preview: 'Keep the good snacks stocked…',
    body: [[{ text: 'Her appetite is back, with opinions. ' }, { text: 'Keep the good snacks stocked — and never, ever finish the last one.', bold: true }]],
  },
  22: {
    preview: 'Practice the car-seat install now…',
    body: [[{ text: 'Start practicing the car-seat install now, not in the hospital parking lot. ' }, { text: 'Future-you says thanks.', bold: true }]],
  },
  23: {
    preview: 'A 10-minute foot rub beats flowers…',
    body: [[{ text: 'Her feet are doing overtime. ' }, { text: 'A 10-minute foot rub tonight scores more points than flowers.', bold: true }]],
  },
  24: {
    preview: 'A quiet milestone — mark it somehow…',
    body: [[{ text: 'Week 24 is a quiet milestone worth marking. ' }, { text: 'A nice dinner, a walk, just the two of you.', bold: true }]],
  },
  25: {
    preview: 'Keep her favorites within arm’s reach…',
    body: [[{ text: 'Heartburn is common now. ' }, { text: 'Keep the antacids she likes within arm’s reach of the bed.', bold: true }]],
  },
  26: {
    preview: 'Try reading aloud in the evenings…',
    body: [[{ text: 'Her eyes can open and close now. ' }, { text: 'Try reading aloud in the evenings — she may already know your voice.', bold: true }]],
  },
  27: {
    preview: 'Take over one weekly chore, permanently…',
    body: [[{ text: 'The third trimester is near. ' }, { text: 'Take over one weekly chore permanently — laundry, dishes, your pick.', bold: true }]],
  },
  28: {
    preview: 'Be the one who knows where the water bottle is…',
    body: [[{ text: 'Sleep gets choppy from here, so be the one who always knows where the water bottle is. ' }, { text: 'Small thing. Huge thing.', bold: true }]],
  },
  29: {
    preview: 'Offer the heating pad before she asks…',
    body: [[{ text: 'Backaches love company. ' }, { text: 'Offer the heating pad before she asks — anticipation beats reaction.', bold: true }]],
  },
  30: {
    preview: 'Slow down with her — it’s a stroll, not a race…',
    body: [[{ text: 'Feeling breathless on the stairs is common now. ' }, { text: 'Slow down with her — it’s a stroll, not a race.', bold: true }]],
  },
  31: {
    preview: 'Pack the hospital bag together…',
    body: [[{ text: 'Pack the hospital bag together this week. ' }, { text: 'It makes the whole thing feel real in the best way.', bold: true }]],
  },
  32: {
    preview: 'Learn the kick-counting routine…',
    body: [[{ text: 'Kick counting may start soon. ' }, { text: 'Learn the routine so you can be the official counter on lazy evenings.', bold: true }]],
  },
  33: {
    preview: 'Be the designated reacher of high shelves…',
    body: [[{ text: 'Her center of gravity has moved. ' }, { text: 'Be the designated reacher-of-high-shelves and tier-of-shoelaces.', bold: true }]],
  },
  34: {
    preview: 'Hand her the paint roller — then let her direct…',
    body: [[{ text: 'The nesting instinct is real. ' }, { text: 'Hand her the paint roller for the nursery — then actually let her direct.', bold: true }]],
  },
  35: {
    preview: 'Drive her, wait with the good snacks…',
    body: [[{ text: 'Weekly appointments may begin. ' }, { text: 'Drive her, wait with the good snacks, and bring your own questions too.', bold: true }]],
  },
  36: {
    preview: 'Every week is a finish line now…',
    body: [[{ text: 'Most babies settle head-down around now. ' }, { text: 'Celebrate the small wins — every week is a finish line.', bold: true }]],
  },
  37: {
    preview: 'Keep the car fueled and the bag by the door…',
    body: [[{ text: 'Early term. ' }, { text: 'Keep the car fueled, the bag by the door, and your phone charged — the boring stuff matters now.', bold: true }]],
  },
  38: {
    preview: 'Make rest possible…',
    body: [[{ text: 'She’s tired in a way sleep doesn’t fix. ' }, { text: 'Your job: make rest possible — handle the noise, the chores, the world.', bold: true }]],
  },
  39: {
    preview: 'Keep everything wonderfully boring…',
    body: [[{ text: 'Full term. ' }, { text: 'Take the long walk together, and keep everything wonderfully boring.', bold: true }]],
  },
  40: {
    preview: 'Stay close, stay reachable…',
    body: [[{ text: 'Any day now. ' }, { text: 'Stay close, stay reachable — and keep telling her she’s doing beautifully. Because she is.', bold: true }]],
  },
};

// ---------------------------------------------------------------------------
// Traditions — how the world celebrates pregnancy. Framed as celebration,
// never prescription. Each verified against reputable general sources.
// ---------------------------------------------------------------------------

interface BankEntry {
  preview: string;
  body: DelightBody;
}

export const TRADITIONS: BankEntry[] = [
  {
    preview: 'The valaikaapu bangle ceremony…',
    body: [[{ text: 'In parts of India, the ' }, { text: 'valaikaapu', bold: true }, { text: ' ceremony adorns the mother-to-be with bangles in her seventh month — the chimes are said to awaken the baby’s senses.' }]],
  },
  {
    preview: 'Godh Bharai — a lap full of abundance…',
    body: [[{ text: 'In North India, ' }, { text: 'Godh Bharai', bold: true }, { text: ' fills the mother-to-be’s lap with fruit, sweets, and gifts — a celebration of abundance before the arrival.' }]],
  },
  {
    preview: 'The Navajo Blessingway…',
    body: [[{ text: 'In Navajo tradition, a ' }, { text: 'Blessingway', bold: true }, { text: ' ceremony surrounds the mother-to-be with the women in her life — songs and prayers for a safe, harmonious birth.' }]],
  },
  {
    preview: 'Finland’s baby box, since the 1930s…',
    body: [[{ text: 'Since the 1930s, Finland has given every new parent a ' }, { text: 'baby box', bold: true }, { text: ' — clothes, bedding, and the box itself doubles as a first crib.' }]],
  },
  {
    preview: 'Germany’s little booklet of the whole story…',
    body: [[{ text: 'In Germany, every pregnant woman receives a ' }, { text: 'Mutterpass', bold: true }, { text: ' — a small booklet carried everywhere, holding the whole pregnancy story in one place.' }]],
  },
  {
    preview: 'Omugwo — the grandmother comes to stay…',
    body: [[{ text: 'Among the Igbo of Nigeria, ' }, { text: 'omugwo', bold: true }, { text: ' brings the grandmother to stay after the birth — cooking, guiding, and holding the household together.' }]],
  },
  {
    preview: 'Japan’s Day of the Dog shrine visit…',
    body: [[{ text: 'In Japan, on the ' }, { text: 'Day of the Dog', bold: true }, { text: ' in the fifth month, many visit a shrine for an easy delivery — dogs were believed to give birth easily.' }]],
  },
  {
    preview: 'In Brazil, the new mother gives the gifts…',
    body: [[{ text: 'In parts of Brazil, tradition flips the script — the ' }, { text: 'new mother gives gifts', bold: true }, { text: ' to visitors who come to meet the baby.' }]],
  },
  {
    preview: 'China’s full-month feast…',
    body: [[{ text: 'In China, the baby’s first full month is celebrated with ' }, { text: 'mǎn yuè', bold: true }, { text: ' — red eggs and a feast to welcome the little one into the family.' }]],
  },
  {
    preview: 'The Netherlands serves rusks with sprinkles…',
    body: [[{ text: 'In the Netherlands, new parents serve ' }, { text: 'beschuit met muisjes', bold: true }, { text: ' — rusks with aniseed sprinkles, pink-and-white or blue-and-white — to everyone who visits.' }]],
  },
];

// ---------------------------------------------------------------------------
// Stories — tiny histories of pregnancy science and care. Wonder-first,
// fact-checked, 2–3 sentences each.
// ---------------------------------------------------------------------------

export const STORIES: BankEntry[] = [
  {
    preview: '1958: a Glasgow doctor borrowed an industrial flaw-detector…',
    body: [[{ text: 'In 1958, Glasgow doctor ' }, { text: 'Ian Donald', bold: true }, { text: ' borrowed an industrial flaw-detector — built to find cracks in metal — and aimed it at a pregnancy. Every ultrasound since descends from that repurposed machine.' }]],
  },
  {
    preview: 'The 10-point score invented in 1952…',
    body: [[{ text: 'In 1952, anesthesiologist ' }, { text: 'Virginia Apgar', bold: true }, { text: ' invented a 10-point score to assess newborns in their first minutes. It took years to catch on — now it’s done for nearly every baby born.' }]],
  },
  {
    preview: 'Baby warmers were inspired by chickens…',
    body: [[{ text: 'In 1880, Paris doctor Stéphane Tarnier saw ' }, { text: 'poultry incubators at the zoo', bold: true }, { text: ' and had an idea: warm boxes for premature babies. Infant warming was born from chickens.' }]],
  },
  {
    preview: 'The trumpet-shaped horn midwives still use…',
    body: [[{ text: 'In 1895, French doctor Adolphe Pinard invented a ' }, { text: 'trumpet-shaped horn', bold: true }, { text: ' to listen to the fetal heartbeat — and midwives still use its descendants today.' }]],
  },
  {
    preview: 'The 280-day math is from the 1830s…',
    body: [[{ text: 'The 280-day due-date math comes from ' }, { text: 'Franz Naegele', bold: true }, { text: ', a German professor who published it around 1830 — before anyone understood how conception worked.' }]],
  },
  {
    preview: '“Obstetrics” means “one who stands by”…',
    body: [[{ text: 'The word ' }, { text: 'obstetrics', bold: true }, { text: ' comes from the Latin obstetrix — “one who stands by.” The job description hasn’t changed in 2,000 years.' }]],
  },
  {
    preview: 'First movements were once called “quickening”…',
    body: [[{ text: 'For centuries, the first felt movements were called ' }, { text: 'quickening', bold: true }, { text: ' — from an old word meaning “coming to life.” It was once the emotional proof of pregnancy.' }]],
  },
  {
    preview: 'The stethoscope began as a rolled-up paper…',
    body: [[{ text: 'In 1816, René Laennec rolled paper into a tube to hear a patient’s chest — the ' }, { text: 'stethoscope', bold: true }, { text: ' began as a paper roll, invented out of politeness.' }]],
  },
];


// ---------------------------------------------------------------------------
// Selection — deterministic, on-device, offline-safe.
// ---------------------------------------------------------------------------

/** Rotation state key in the app kv store. Bump the suffix if the shape changes. */
export const DELIGHT_STATE_KEY = 'delight.v1';

interface DelightRotationState {
  /** Last device-local day rotation advanced, YYYY-MM-DD. */
  date: string;
  /** Per-kind cursor: index of the NEXT item to show from that kind's bank. */
  cursors: Partial<Record<DelightKind, number>>;
}

function loadState(store: DelightStore | null): DelightRotationState | null {
  if (!store) return null;
  try {
    const raw = store.get(DELIGHT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DelightRotationState>;
    if (typeof parsed.date !== 'string' || typeof parsed.cursors !== 'object' || parsed.cursors === null) {
      return null;
    }
    return { date: parsed.date, cursors: parsed.cursors };
  } catch {
    return null; // Corrupt state recovers silently.
  }
}

function saveState(store: DelightStore | null, state: DelightRotationState): void {
  if (!store) return;
  try {
    store.set(DELIGHT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Best effort — rotation still works deterministically without persistence.
  }
}

/** Day of year for a YYYY-MM-DD date (1–366). Pure calendar math. */
export function dayOfYear(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 1;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(Number(m[1]), 0, 1);
  return Math.floor((dt.getTime() - start.getTime()) / 86400000) + 1;
}

function clampWeek(week: number): number {
  if (!Number.isFinite(week)) return MIN_SIZE_WEEK;
  return Math.min(MAX_SIZE_WEEK, Math.max(MIN_SIZE_WEEK, Math.round(week)));
}

/** Matrix-driven options for the delight pickers (v1.1 rules engine). */
export interface BuildDelightOptions {
  /**
   * Matrix-preferred fact ids (see WeekMatrixRow.delight.factIds). When
   * non-empty and matching, the fact is picked from these ids (rotated by
   * day of year); otherwise the week-range bank applies.
   */
  factIds?: string[];
  /**
   * Matrix-preferred rotating kinds. When non-empty, today's rotating kind
   * is picked from these (by day of year) instead of the default rotation.
   * 'name' is dropped from the list when no baby name is set (see
   * hasBabyName).
   */
  rotatingBoost?: RotatingKind[];
  /**
   * Whether the user has given the baby a name. Gates the 'name' rotating
   * kind: true → the slot celebrates the chosen name; false/omitted → the
   * kind is filtered out of the rotation entirely. The card itself carries
   * {Name} tokens (substituted on-device in policy.toBriefing) — the real
   * name never reaches this picker.
   */
  hasBabyName?: boolean;
}

/** Pick the fact card for this week: matrix ids first, then week-anchored facts, evergreen fallback. */
function pickFact(week: number, today: string, factIds?: string[]): DelightCard {
  const w = clampWeek(week);
  let pool: FactEntry[] = [];
  if (factIds && factIds.length > 0) {
    pool = factIds
      .map((id) => FACTS.find((f) => f.id === id))
      .filter((f): f is FactEntry => !!f);
  }
  if (pool.length === 0) {
    const anchored = FACTS.filter(
      (f) => f.weeks && w >= f.weeks[0] && w <= f.weeks[1],
    );
    pool = anchored.length > 0 ? anchored : FACTS;
  }
  const entry = pool[dayOfYear(today) % pool.length];
  const tile = TILES.fact;
  return {
    id: 'delight-card-fact',
    kind: 'fact',
    title: 'Did you know?',
    preview: entry.preview,
    body: entry.body,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
  };
}

/** Pick the size card: fixed per-week mapping, clamped to 12–40. */
function pickSize(week: number): DelightCard {
  const w = clampWeek(week);
  const entry = SIZE_BY_WEEK[w];
  const tile = TILES.size;
  return {
    id: 'delight-card-size',
    kind: 'size',
    title: 'How big is {name}?',
    preview: `${entry.delight} — ${entry.length}, ${entry.weight}…`,
    body: [
      [
        { text: `About the size of ${entry.delight} — ` },
        { text: `${entry.length}, ${entry.weight}.`, bold: true },
        { text: ` ${w < MAX_SIZE_WEEK ? 'Taller than she is heavy, for now.' : 'The classic, at last.'}` },
      ],
    ],
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
  };
}

/** Milestone ahead: the next marker, framed as anticipation, never a deadline. */
function milestoneFor(week: number): BankEntry {
  if (week < 24) {
    return {
      preview: 'Week 24 — most of the essential building done…',
      body: [[{ text: 'By ' }, { text: 'week 24', bold: true }, { text: ', most of the essential building is done — the rest is growing, practicing, and getting ready.' }]],
    };
  }
  if (week < 28) {
    const n = 28 - week;
    return {
      preview: `${n} ${n === 1 ? 'week' : 'weeks'} to the third trimester…`,
      body: [[{ text: 'Week 28', bold: true }, { text: ` opens the third trimester — the home stretch begins. ${n} ${n === 1 ? 'week' : 'weeks'} to go.` }]],
    };
  }
  if (week < 32) {
    const n = 32 - week;
    return {
      preview: `${n} ${n === 1 ? 'week' : 'weeks'} to week 32 — mostly growing time…`,
      body: [[{ text: `${n} ${n === 1 ? 'week' : 'weeks'} to ` }, { text: 'week 32', bold: true }, { text: ' — most of the building is done, and the last stretch is mostly growing time. The finish line is close enough to picture.' }]],
    };
  }
  if (week < 37) {
    const n = 37 - week;
    return {
      preview: `${n} ${n === 1 ? 'week' : 'weeks'} to early term…`,
      body: [[{ text: 'Week 37', bold: true }, { text: ` is “early term” — from there, arrival could be any day now. ${n} ${n === 1 ? 'week' : 'weeks'} to go.` }]],
    };
  }
  if (week < 39) {
    const n = 39 - week;
    return {
      preview: `${n} ${n === 1 ? 'week' : 'weeks'} to full term…`,
      body: [[{ text: 'Week 39', bold: true }, { text: ` is full term — the finishing touches are nearly all in place. ${n} ${n === 1 ? 'week' : 'weeks'} to go.` }]],
    };
  }
  return {
    preview: 'Week 40 — the grand finale…',
    body: [[{ text: 'Week 40', bold: true }, { text: ' — the grand finale. She’s officially ready whenever she is.' }]],
  };
}

const ROTATING_BANKS: Record<'partner' | 'tradition' | 'story', BankEntry[]> = {
  partner: [], // partner tips are per-week, handled separately below
  tradition: TRADITIONS,
  story: STORIES,
  // 'name' has no bank: when a baby name is set, the rotating slot becomes
  // a celebration of the chosen name (see nameCelebrationCard); when no
  // name is set, the kind is filtered out of the rotation entirely.
};

export const ROTATING_TITLES: Record<DelightKind, string> = {
  fact: 'Did you know?',
  size: 'How big is {name}?',
  partner: 'For the partner',
  tradition: 'Traditions',
  story: 'Story of the week',
  name: "Your baby's name",
  milestone: 'Milestone ahead',
};

/**
 * The name-celebration card: shown as the rotating 'name' kind only when
 * the user has given the baby a name. Celebrates the choice warmly and
 * NEVER invents a meaning — the story of the name belongs to the family.
 * Carries {Name} tokens; policy.toBriefing substitutes on-device.
 */
function nameCelebrationCard(): DelightCard {
  const tile = TILES.name;
  return {
    id: 'delight-card-rotating',
    kind: 'name',
    title: ROTATING_TITLES.name,
    preview: 'You chose {name} ♥…',
    body: [
      [
        { text: '{Name}', bold: true },
        {
          text: ' — you chose it. A name with a story only your family knows. Say it out loud now and then; it already sounds like someone you love.',
        },
      ],
    ],
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
  };
}

/**
 * Pick the rotating third card. The KIND rotates by day of year; the item
 * within the bank advances via the persisted per-kind cursor (one step per
 * day), so repeat visits feel fresh without repeats. Milestone is computed
 * from the week; partner tips are per-week. The 'name' kind is only
 * eligible when hasBabyName is true — otherwise it is filtered out before
 * the pick (no name → no name card, by Anuraj's rule).
 */
function pickRotating(
  week: number,
  store: DelightStore | null,
  today: string,
  boost?: RotatingKind[],
  hasBabyName = false,
): DelightCard {
  const base = boost && boost.length > 0 ? boost : ROTATION_ORDER;
  const order = hasBabyName ? base : base.filter((k) => k !== 'name');
  const kinds = order.length > 0 ? order : ROTATION_ORDER.filter((k) => k !== 'name');
  const kind = kinds[dayOfYear(today) % kinds.length];
  if (kind === 'name') return nameCelebrationCard();
  let state = loadState(store);
  if (!state || state.date !== today) {
    // New day: advance the cursor for today's kind and persist.
    const cursors = { ...(state?.cursors ?? {}) };
    cursors[kind] = (cursors[kind] ?? 0) + 1;
    state = { date: today, cursors };
    saveState(store, state);
  }
  const cursor = state.cursors[kind] ?? 0;
  const tile = TILES[kind];

  let entry: BankEntry;
  if (kind === 'partner') {
    const tip = PARTNER_TIPS[clampWeek(week)];
    entry = tip;
  } else if (kind === 'milestone') {
    entry = milestoneFor(week);
  } else if (kind === 'tradition' || kind === 'story') {
    const bank = ROTATING_BANKS[kind];
    entry = bank[cursor % bank.length];
  } else {
    // Unreachable: 'name' returns the celebration card before this point,
    // and 'fact'/'size' never rotate. Falls back to traditions defensively.
    entry = TRADITIONS[cursor % TRADITIONS.length];
  }

  return {
    id: `delight-card-rotating`,
    kind,
    title: ROTATING_TITLES[kind],
    preview: entry.preview,
    body: entry.body,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
  };
}

/**
 * Build the 3 delight cards for a gestational week:
 * [fact, size, rotating]. Deterministic for a given (week, today, store);
 * the same day returns the same cards (idempotent).
 */
export function buildDelightCards(
  week: number,
  store: DelightStore | null,
  today: string,
  opts: BuildDelightOptions = {},
): DelightCard[] {
  return [
    pickFact(week, today, opts.factIds),
    pickSize(week),
    pickRotating(week, store, today, opts.rotatingBoost, opts.hasBabyName),
  ];
}
