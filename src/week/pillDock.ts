/**
 * Week-tab pill dock geometry (Anuraj, Sept 20, 2026).
 *
 * The floating Ask/Kicks pills are pinned bottom-right OVER the Week
 * screen — they never constrain the scroll layout.
 *
 * ROUND 3 (Anuraj caught it on his iPhone, Sept 20, 2026 — AFTER the
 * round-2 color fix shipped): the colors were all correct (dock
 * transparent, root cream) and every check passed, yet the "solid band"
 * was still visible on his phone. Root cause was GEOMETRY, not color:
 * the dock was an IN-FLOW 160/96pt sibling rendered AFTER <Screen>,
 * so the Screen's scroll viewport ended mid-page. On short viewports
 * (iPhone 667pt) a white card hard-clipped at the Screen's bottom edge
 * — a perfectly straight seam — above the static 160pt cream zone.
 * That straight edge + static empty zone reads as a "solid band",
 * even when every sampled color is exactly right. Tall desktop
 * viewports never showed it (content fit), which is why round 2
 * looked seamless in every check.
 *
 * The round-3 rule is structural:
 *   1. the pill zone (PILL_DOCK_OVERLAY_STYLE) is an ABSOLUTE overlay
 *      pinned bottom-right with ZERO in-flow footprint — it constrains
 *      no layout height, so the Screen scrolls full height to the tab
 *      bar and no mid-page clip boundary can exist;
 *   2. the 160/96pt reserve lives INSIDE the scroll content as
 *      paddingBottom = pillDockHeight(showKicksPill), so at max scroll
 *      the last content (rounded cards, footer) rests above the pills
 *      over continuous cream — pills never permanently obscure text;
 *   3. the dock stays transparent and the screen root stays page cream
 *      (rounds 1-2 rules, kept).
 * Mid-scroll transient pass-under while scrolling is acceptable and
 * matches the approved "pills floating over the page" design.
 *
 * No pointerEvents prop on the overlay: it has no area, so it can
 * never swallow scrolls/taps on any platform. (pointerEvents="box-none"
 * was considered and rejected — it is invalid CSS on web, the browser
 * drops it, and a full-screen overlay would freeze the screen;
 * verified Sept 20, 2026.)
 *
 * Pure module (no react-native imports) so the unit suite can assert
 * the guard directly under node. See tests/week_pill_dock.test.ts.
 */

import { colors } from '../theme/tokens';

/** The dock background. Transparent, always — never a solid fill. */
export const PILL_DOCK_BACKGROUND = 'transparent' as const;

/**
 * The Week screen root background behind the dock. Must be the page
 * cream (#FAF6F0) so the transparent pill zone is cream-
 * indistinguishable from the scroll content. Applied to styles.askRoot
 * in app/(tabs)/week.tsx.
 */
export const PILL_DOCK_PARENT_BACKGROUND = colors.bg;

/**
 * The pill-zone overlay style contract (round 3). week.tsx must apply
 * this to the `week-pill-dock` element: absolute, pinned bottom-right,
 * NO width/height/top/left — zero in-flow footprint. Any in-flow
 * height here re-opens the mid-page clip seam.
 */
export const PILL_DOCK_OVERLAY_STYLE = {
  position: 'absolute',
  right: 0,
  bottom: 0,
  backgroundColor: PILL_DOCK_BACKGROUND,
} as const;

/**
 * Reserved dock height: 160pt fits both pills (kicks at bottom:86 +
 * 56 tall, ask at bottom:18 + 56 tall) with breathing room; 96pt fits
 * the Ask pill alone.
 */
export function pillDockHeight(showKicksPill: boolean): number {
  return showKicksPill ? 160 : 96;
}
