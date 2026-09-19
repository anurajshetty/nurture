/**
 * Briefing contracts (track 2: briefing UI).
 *
 * Owned by the briefing-UI agent; the refresh-logic agent's useBriefing
 * produces these shapes, and the tab agent's new app/(tabs)/index.tsx
 * renders BriefingScreen (which consumes them).
 */

/** The four briefing cards, always in this order on screen. */
export interface BriefingCard {
  id: 'baby' | 'body' | 'know' | 'tips';
  /** Card title, e.g. "Baby's development". */
  title: string;
  /** Small line under the title, e.g. "About the size of an eggplant". */
  subtitle: string;
  /** Compact paragraphs — a few short lines each, never a wall of text. */
  body: string[];
}

/** One morning briefing, cached locally so offline still shows content. */
export interface Briefing {
  /** Gestational week the briefing was generated for. */
  week: number;
  /** Day within the week (1–7). */
  day: number;
  /** Local date the briefing was generated for, YYYY-MM-DD. */
  generatedForDate: string;
  /** The four cards (order is normalized to baby → body → know → tips). */
  cards: BriefingCard[];
  /** Content review date, YYYY-MM-DD, shown in the footer. */
  reviewDate: string;
}

/**
 * Briefing screen state:
 * - live: fresh briefing, cards shown.
 * - generating: the week's briefing is being built (spinner + skeletons).
 * - offline: no network — cached briefing with a gentle banner.
 * - empty: nothing to show yet (no briefing, or no due date).
 */
export type BriefingStatus = 'live' | 'generating' | 'offline' | 'empty';
