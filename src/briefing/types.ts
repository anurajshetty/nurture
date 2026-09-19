/**
 * Briefing contracts (v1.1: rules-engine Home).
 *
 * The Home tab renders the engine's ordered plan: timely cards, the 4
 * routine cards, the week-transition heads-up, the delight cards, and the
 * quiet-day look-back teaser — all as uniform compact expandable rows.
 *
 * Data flow:
 * 1. `src/briefing/engine.ts` builds the ordered `PlanSlot[]` on-device
 *    from the 40-week matrix (`./matrix.ts`) — deterministic, offline-safe.
 * 2. The edge function phrases the `phrase: true` slots warmly (LLM as
 *    phraser, never inventing facts); unreachable → render curated copy.
 * 3. `BriefingScreen` renders `briefing.slots` in order.
 */

/** One run of text inside a paragraph; bold marks the warm emphasis. */
export interface TextRun {
  text: string;
  bold?: boolean;
}

/** Body = paragraphs of runs (delight-style rich text). */
export type RichBody = TextRun[][];

/** Where a slot sits in the Home order. */
export type PlanSection =
  | 'timely'
  | 'routine'
  | 'headsup'
  | 'delight'
  | 'lookback';

/**
 * One card on the Home plan. Curated on-device; the `phrase` slots may be
 * reworded by the LLM phraser, the rest render verbatim always.
 */
export interface PlanSlot {
  /** Stable id, e.g. 'routine-baby', 'timely-prep-hospital-bag', 'headsup'. */
  slotId: string;
  section: PlanSection;
  /** Row title — curated, never rephrased (stability is a feature). */
  title: string;
  /** One-line collapsed preview (ellipsis-truncated by the row). */
  preview: string;
  /** Curated body; replaced by phrased text when the phraser succeeds. */
  body: RichBody;
  /**
   * Whether the LLM phraser may reword this slot. False for content that
   * must stay verbatim: delight (already warm) and the look-back teaser
   * (her own words — never rewritten).
   */
  phrase: boolean;
  /** Tinted icon tile. */
  tint: string;
  /** Text glyph on the tile (dingbat, renders as text on all platforms). */
  glyph: string;
  glyphColor: string;
  testID: string;
  /**
   * v1.2: milestone event id behind a one-time celebrated card. Set only by
   * the milestone-celebrated slot; the delivery layer (policy.ts) marks it
   * shown when the briefing actually reaches the screen.
   */
  celebratedEventId?: string;
}

/** One morning briefing: the engine's ordered plan, phrased where available. */
export interface Briefing {
  /** Gestational week the briefing was generated for. */
  week: number;
  /** Day within the week (1–7). */
  day: number;
  /** Local date the briefing was generated for, YYYY-MM-DD. */
  generatedForDate: string;
  /**
   * Ordered slots: timely → routine (baby → body → know → tips) →
   * headsup → delight → lookback. The screen renders them in this order,
   * inserting the "A little wonder" divider before the first delight slot.
   */
  slots: PlanSlot[];
  /** Content review date, YYYY-MM-DD, shown in the footer. */
  reviewDate: string;
  /** Stable hash of the engine plan; part of the LLM cache key. */
  planHash: string;
}

/**
 * Legacy v1 routine card (kept for the old edge-function generator
 * contract, used only while the phraser function is not yet deployed).
 */
export interface BriefingCard {
  id: 'baby' | 'body' | 'know' | 'tips';
  /** Card title, e.g. "Baby's development". */
  title: string;
  /** Small line under the title, e.g. "About the size of an eggplant". */
  subtitle: string;
  /** Compact paragraphs — a few short lines each, never a wall of text. */
  body: string[];
}

/**
 * Briefing screen state:
 * - live: fresh briefing, cards shown.
 * - generating: the week's briefing is being built (spinner + skeletons).
 * - offline: no network — cached briefing with a gentle banner.
 * - empty: nothing to show yet (no briefing, or no due date).
 */
export type BriefingStatus = 'live' | 'generating' | 'offline' | 'empty';
