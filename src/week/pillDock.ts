/**
 * Week-tab pill dock geometry (Anuraj, Sept 20, 2026).
 *
 * The floating Ask/Kicks pills live in reserved layout space BELOW the
 * Week scroll content instead of floating OVER it, so body text can
 * never slide under the pills. The pills keep their approved floating
 * look and bottom-right position; only the overlap is gone.
 *
 * REGRESSION GUARD (Anuraj caught it on his iPhone, Sept 20 2026):
 * this container must NEVER carry a visible fill. Its background stays
 * transparent — the page cream shows through behind the pills — so no
 * solid color block ever appears under them. Rule: layout containers
 * added to fix overlap issues must not introduce a visible fill. Only
 * the reserved HEIGHT may change here, never the background.
 *
 * Pure module (no react-native imports) so the unit suite can assert
 * the guard directly under node. See tests/week_pill_dock.test.ts.
 */

/** The dock background. Transparent, always — never colors.bg. */
export const PILL_DOCK_BACKGROUND = 'transparent' as const;

/**
 * Reserved dock height: 160pt fits both pills (kicks at bottom:86 +
 * 56 tall, ask at bottom:18 + 56 tall) with breathing room; 96pt fits
 * the Ask pill alone.
 */
export function pillDockHeight(showKicksPill: boolean): number {
  return showKicksPill ? 160 : 96;
}
