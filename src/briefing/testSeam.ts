/**
 * Test-only override seam for the briefing screen.
 *
 * Production never sets this: BriefingTestOverrideContext is null unless
 * the interactive test route (app/briefing-test.tsx) wraps BriefingScreen
 * in the provider. The route then exposes
 * `window.__briefingTest = { setStatus, seedBriefing }`, letting the
 * Playwright test force each BriefingStatus with seeded data without
 * touching the real refresh pipeline.
 */

import { createContext, useContext } from 'react';
import type { Briefing, BriefingStatus } from './types';

export interface BriefingTestOverride {
  status: BriefingStatus;
  briefing: Briefing | null;
}

export const BriefingTestOverrideContext =
  createContext<BriefingTestOverride | null>(null);

/** Null in production; set only by the test route's provider. */
export function useBriefingTestOverride(): BriefingTestOverride | null {
  return useContext(BriefingTestOverrideContext);
}
