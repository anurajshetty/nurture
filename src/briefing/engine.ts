/**
 * Deterministic on-device rules engine for Home v1.1.
 *
 * `buildPlan()` turns a matrix row into the ordered card plan — no
 * network, no LLM. The plan is the truth; the LLM phraser may only warm
 * the wording of the `phrase: true` slots. Rendered curated copy is the
 * complete offline fallback, so Home never blanks.
 *
 * Order (Anuraj, Sept 2026):
 * 1. Timely — milestone countdowns (next week) and prep windows.
 * 2. Routine four, fixed: baby → body → know → tips.
 * 3. "New this week" — only on gestational days 1–2, below the routine
 *    cards (never at the top).
 * 4. "A little wonder" divider — rendered by the screen before the first
 *    delight slot.
 * 5. Fact + size + rotating delight (matrix steers the fact ids and the
 *    rotating kinds; never repeats still-visible cards).
 * 6. Look-back teaser — only on quiet days (gestational 3–7) and only when
 *    the plan is not crowded.
 *
 * Out of scope for v1.1 (need Epics 4.5/4.7): visit-prep cards,
 * milestone-celebrated cards.
 */

import { colors } from '../theme/tokens';
import {
  buildDelightCards,
  ROTATION_ORDER,
  type DelightCard,
  type DelightStore,
  type RotatingKind,
} from './delight';
import {
  getMatrixRow,
  hasCuratedRow,
  activePrepForWeek,
  type MatrixMilestone,
  type MatrixPrep,
  type WeekMatrixRow,
} from './matrix';
import type { AgeBandValue } from './context';
import type { PlanSection, PlanSlot, RichBody } from './types';

/** Routine-card titles — the stable contract, never rephrased. */
const ROUTINE_TITLES = {
  baby: "Baby's development",
  body: "How you're doing",
  know: 'Good to know',
  tips: 'Small comforts',
} as const;

type RoutineId = keyof typeof ROUTINE_TITLES;

const ROUTINE_ORDER: readonly RoutineId[] = ['baby', 'body', 'know', 'tips'];

const LILAC_TINT = '#EFEAF7';
const GOLD_DEEP = '#96771B';
const TEAL_TINT = '#E2F0EF';
const TEAL_DEEP = '#5F9E9B';
const BLUE_DEEP = '#4E7FA3';

interface Tile {
  tint: string;
  glyph: string;
  glyphColor: string;
}

const TILES: Record<string, Tile> = {
  'routine-baby': { tint: colors.goldTint, glyph: '❀', glyphColor: GOLD_DEEP },
  'routine-body': { tint: colors.blush, glyph: '♥', glyphColor: colors.coralDeep },
  'routine-know': { tint: LILAC_TINT, glyph: '✎', glyphColor: colors.lilac },
  'routine-tips': { tint: colors.sageTint, glyph: '☀', glyphColor: colors.sageDeep },
  'timely-milestone': { tint: TEAL_TINT, glyph: '☀', glyphColor: TEAL_DEEP },
  'timely-prep': { tint: colors.sageTint, glyph: '✓', glyphColor: colors.sageDeep },
  headsup: { tint: colors.blueTint, glyph: '→', glyphColor: BLUE_DEEP },
  lookback: { tint: colors.blush, glyph: '❀', glyphColor: colors.coralDeep },
};

/** What the engine needs; the caller assembles this from local state. */
export interface EngineInput {
  /** Gestational week, 4–42. */
  week: number;
  /** Gestational day, 1–7. */
  day: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
  firstTimeMom: boolean;
  ageBand?: AgeBandValue;
  /** Anonymized aggregate symptom labels (≤5); context for the phraser only. */
  symptomThemes: string[];
  /** Recent journal entries (id, text, date) — only for the look-back. */
  logs: Array<{ id: string; text: string; date: string }>;
  /** Persisted delight rotation state. */
  store: DelightStore | null;
}

/** The engine's output: the ordered plan plus its stable hash. */
export interface EnginePlan {
  slots: PlanSlot[];
  /** Deterministic hash of the plan; part of the phraser cache key. */
  planHash: string;
  /** True when a fully-curated matrix row drove the plan. */
  curated: boolean;
}

/** Max 1 prep card/day: earliest window end wins; on a tie the narrower
 *  window (later start) wins — it's the more time-pressing task. */
function pickPrep(prep: MatrixPrep[]): MatrixPrep | null {
  if (prep.length === 0) return null;
  return [...prep].sort(
    (a, b) => a.window[1] - b.window[1] || b.window[0] - a.window[0],
  )[0];
}

function para(text: string, bold = false): RichBody {
  return [[{ text, bold }]];
}

function textOf(body: RichBody): string {
  return body
    .map((p) => p.map((r) => r.text).join(''))
    .join('\n');
}

/** Deterministic 32-bit hash → 8 hex chars. Pure, no crypto needed. */
export function hashPlan(slots: PlanSlot[]): string {
  const src = JSON.stringify(
    slots.map((s) => [s.slotId, s.title, s.preview, textOf(s.body)]),
  );
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** "2026-09-19" → "Sep 19". Falls back to the raw value. */
function monthDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const label = months[Number(m[2]) - 1];
  return label ? `${label} ${Number(m[3])}` : iso;
}

function routineSlot(
  id: RoutineId,
  row: WeekMatrixRow,
  input: EngineInput,
): PlanSlot {
  const seeds = row.routineSeeds[id];
  const body: RichBody = seeds.map((s) => [{ text: s }]);
  // First-time vs experienced framing lands in the "know" card (proposal §4);
  // the age-band note, when set, lands in the "body" card.
  if (id === 'know') {
    const note = input.firstTimeMom ? row.firstTimeNote : row.experiencedNote;
    if (note) body.push([{ text: note }]);
  }
  if (id === 'body' && input.ageBand && row.ageBandNotes?.[input.ageBand]) {
    body.push([{ text: row.ageBandNotes[input.ageBand] as string }]);
  }
  const preview =
    id === 'baby'
      ? row.anchors.baby
      : id === 'body'
        ? row.anchors.body
        : id === 'know'
          ? 'General information — your care team knows the rest'
          : 'Tiny things that can help today';
  const tile = TILES[`routine-${id}`];
  return {
    slotId: `routine-${id}`,
    section: 'routine',
    title: ROUTINE_TITLES[id],
    preview,
    body,
    phrase: true,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
    testID: `briefing-card-${id}`,
  };
}

function milestoneSlot(m: MatrixMilestone): PlanSlot {
  const tile = TILES['timely-milestone'];
  return {
    slotId: `timely-milestone-${m.id}`,
    section: 'timely',
    title: m.weekOffset === 0 ? m.label : `One week to ${m.label.toLowerCase()}`,
    preview: m.copy,
    body: para(m.copy),
    phrase: true,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
    testID: `briefing-timely-milestone-${m.id}`,
  };
}

function prepSlot(p: MatrixPrep): PlanSlot {
  const tile = TILES['timely-prep'];
  return {
    slotId: `timely-prep-${p.id}`,
    section: 'timely',
    title: 'A gentle heads-up',
    preview: p.copy,
    body: para(p.copy),
    phrase: true,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
    testID: `briefing-timely-prep-${p.id}`,
  };
}

function headsupSlot(teaser: string): PlanSlot {
  const tile = TILES['headsup'];
  return {
    slotId: 'headsup',
    section: 'headsup',
    title: 'New this week',
    preview: teaser,
    body: para(teaser),
    phrase: true,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
    testID: 'briefing-headsup',
  };
}

function delightSlot(card: DelightCard): PlanSlot {
  return {
    slotId: card.id,
    section: 'delight',
    title: card.title,
    preview: card.preview,
    body: card.body,
    // Delight is already warm and curated — never rephrased.
    phrase: false,
    tint: card.tint,
    glyph: card.glyph,
    glyphColor: card.glyphColor,
    testID: card.id,
  };
}

/**
 * The quiet-day look-back: one of her own earlier entries, quoted verbatim.
 * Her words are never rephrased (phrase: false). Deterministic: the most
 * recent entry at least 3 days old, else the most recent entry.
 */
function lookbackSlot(
  logs: Array<{ id: string; text: string; date: string }>,
  today: string,
): PlanSlot | null {
  const withText = logs.filter(
    (l) => typeof l.text === 'string' && l.text.trim().length > 0,
  );
  if (withText.length === 0) return null;
  const sorted = [...withText].sort((a, b) => (a.date < b.date ? 1 : -1));
  const older = sorted.find((l) => l.date <= addDays(today, -3));
  const pick = older ?? sorted[0];
  const text =
    pick.text.length > 280 ? pick.text.slice(0, 277).trimEnd() + '…' : pick.text;
  const tile = TILES['lookback'];
  return {
    slotId: `lookback-${pick.id}`,
    section: 'lookback',
    title: 'A little look back',
    preview: `${monthDay(pick.date)} — ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
    body: [
      [{ text: `“${text}”` }],
      [{ text: `From your journal, ${monthDay(pick.date)}.` }],
    ],
    phrase: false,
    tint: tile.tint,
    glyph: tile.glyph,
    glyphColor: tile.glyphColor,
    testID: 'briefing-lookback',
  };
}

/** YYYY-MM-DD minus n days. Pure calendar math; falls back to the input. */
function addDays(iso: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Build the ordered plan for a day. Deterministic: the same input always
 * yields the same slots. Never throws — worst case returns the routine
 * four + delight from the fallback row.
 */
export function buildPlan(input: EngineInput): EnginePlan {
  const slots: PlanSlot[] = [];
  const row = getMatrixRow(input.week);
  const curated = hasCuratedRow(input.week);

  // 1. Timely — milestones touching this week (incl. next-week countdowns)
  //    and at most one prep-window card.
  const milestones = row.milestones.filter(
    (m) => m.weekOffset === 0 || m.weekOffset === 1,
  );
  for (const m of milestones) slots.push(milestoneSlot(m));
  const prepPool =
    row.prep.length > 0
      ? row.prep.filter((p) => input.week >= p.window[0] && input.week <= p.window[1])
      : activePrepForWeek(input.week);
  const prep = pickPrep(prepPool);
  if (prep) slots.push(prepSlot(prep));
  const hasMilestoneCountdown = milestones.some((m) => m.weekOffset === 1);

  // 2. Routine four, fixed order.
  for (const id of ROUTINE_ORDER) slots.push(routineSlot(id, row, input));

  // 3. "New this week" — gestational days 1–2 only, below the routine cards.
  const hasHeadsUp = input.day <= 2 && !!row.nextWeekTeaser;
  if (hasHeadsUp) slots.push(headsupSlot(row.nextWeekTeaser as string));

  // 5. Delight — matrix steers fact ids and rotating kinds. The rotating
  //    'milestone' card is suppressed when a curated milestone countdown
  //    is already timely (no duplicates).
  const allKinds: RotatingKind[] = [...ROTATION_ORDER];
  let boost =
    row.delight.rotatingBoost && row.delight.rotatingBoost.length > 0
      ? [...row.delight.rotatingBoost]
      : allKinds;
  if (hasMilestoneCountdown) boost = boost.filter((k) => k !== 'milestone');
  if (boost.length === 0) boost = allKinds.filter((k) => k !== 'milestone');
  let delight: DelightCard[];
  try {
    delight = buildDelightCards(input.week, input.store, input.date, {
      factIds: row.delight.factIds,
      rotatingBoost: boost,
    });
  } catch {
    delight = buildDelightCards(input.week, null, input.date, {
      factIds: row.delight.factIds,
      rotatingBoost: boost,
    });
  }
  for (const card of delight) slots.push(delightSlot(card));

  // 6. Look-back — quiet days (3–7) only, eligible rows only, and only when
  //    the plan is not crowded (fewer than 3 timely cards; a week with two
  //    milestones and a prep card is already full).
  const quietDay = input.day >= 3 && input.day <= 7;
  const timelyCount =
    slots.filter((s) => s.section === 'timely' || s.section === 'headsup').length;
  if (quietDay && row.quietDay.lookbackEligible && timelyCount < 3) {
    const lookback = lookbackSlot(input.logs, input.date);
    if (lookback) slots.push(lookback);
  }

  return { slots, planHash: hashPlan(slots), curated };
}

/** Sections in render order — the screen maps this to rows + divider. */
export const SECTION_ORDER: readonly PlanSection[] = [
  'timely',
  'routine',
  'headsup',
  'delight',
  'lookback',
];
