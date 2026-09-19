/**
 * Epic 9 — afterwards gate for the Home tab (contract C3).
 *
 * Thin wrapper over the support-layer predicate so the briefing screen
 * reads the one shared stop signal (`pregnancy.status === 'stopped'`)
 * without duplicating the logic.
 */

import { isAfterwards as isAfterwardsCore } from '../support/aftermath';

/** True when Home must render the afterwards state — never developmental content. */
export function isAfterwards(): boolean {
  try {
    return isAfterwardsCore();
  } catch {
    return false;
  }
}
