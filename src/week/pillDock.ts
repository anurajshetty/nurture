/**
 * Week-tab pill dock geometry (Anuraj, Sept 20, 2026).
 *
 * The floating Ask/Kicks pills live in reserved layout space BELOW the
 * Week scroll content instead of floating OVER it, so body text can
 * never slide under the pills. The pills keep their approved floating
 * look and bottom-right position; only the overlap is gone.
 *
 * REGRESSION GUARD, corrected round 2 (Anuraj, Sept 20 2026 — the dock
 * still showed a band on web AFTER the transparent fix shipped):
 * "transparent" alone is NOT the rule. The dock sits OUTSIDE the
 * Screen scroll container, directly on the tab screen root, and on web
 * that root's platform default is light gray (#f2f2f2) — so a
 * transparent dock revealed a visible gray band behind the pills. The
 * corrected rule is two-part:
 *   1. the dock itself stays transparent (never a solid fill), AND
 *   2. the Week screen root BEHIND the dock (styles.askRoot) must carry
 *      the page cream (colors.bg #FAF6F0), so the transparent dock
 *      reveals cream — visually indistinguishable from the page.
 * Rule: layout containers added to fix overlap issues must not
 * introduce a visible fill OR reveal a non-cream parent. Only the
 * reserved HEIGHT may change here, never the backgrounds.
 *
 * Pure module (no react-native imports) so the unit suite can assert
 * the guard directly under node. See tests/week_pill_dock.test.ts.
 */

import { colors } from '../theme/tokens';

/** The dock background. Transparent, always — never a solid fill. */
export const PILL_DOCK_BACKGROUND = 'transparent' as const;

/**
 * The Week screen root background behind the dock. Must be the page
 * cream (#FAF6F0) so the transparent dock area is cream-
 * indistinguishable from the scroll content above it. Applied to
 * styles.askRoot in app/(tabs)/week.tsx.
 */
export const PILL_DOCK_PARENT_BACKGROUND = colors.bg;

/**
 * Reserved dock height: 160pt fits both pills (kicks at bottom:86 +
 * 56 tall, ask at bottom:18 + 56 tall) with breathing room; 96pt fits
 * the Ask pill alone.
 */
export function pillDockHeight(showKicksPill: boolean): number {
  return showKicksPill ? 160 : 96;
}
