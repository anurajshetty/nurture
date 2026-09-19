/**
 * Interactive web test harness hooks (Epic 3).
 *
 * ONLY activates when the page URL query includes `testhooks=1`
 * (e.g. https://…/nurture/?testhooks=1). Production is never touched:
 * without the query param this module does nothing at all.
 *
 * Exposes `(window as any).__nurtureTest`:
 * - seedEvent(input) → saveEvent — inserts an event through the real store
 * - clearEvents() → clearAllEvents — resets the timeline
 * - completeOnboarding() — marks onboarding finished so the Home timeline
 *   renders without walking the onboarding flow
 * - seedPregnancy(input) → savePregnancy — inserts a pregnancy record
 *   (used to exercise pregnancy-week bands and the week-jump button)
 */

import { clearAllEvents, saveEvent, savePregnancy } from './sync/store';
import { kvSet } from './lib/db';
import { ONBOARDING_COMPLETED_KEY } from './onboarding/useOnboarding';
import type { EventInput, Pregnancy } from './lib/types';

export function installTestHooks(): void {
  if (typeof window === 'undefined') return;
  const search = typeof window.location?.search === 'string' ? window.location.search : '';
  if (!search.includes('testhooks=1')) return;

  (window as unknown as Record<string, unknown>).__nurtureTest = {
    seedEvent: (input: EventInput) => saveEvent(input),
    clearEvents: () => clearAllEvents(),
    completeOnboarding: () => kvSet(ONBOARDING_COMPLETED_KEY, '1'),
    seedPregnancy: (input: Partial<Pregnancy>) =>
      savePregnancy({
        userId: input.userId ?? null,
        dueDate: input.dueDate ?? null,
        lmpDate: input.lmpDate ?? null,
        pregnancyType: input.pregnancyType ?? 'singleton',
        parity: input.parity ?? 'first',
      }),
  };
}
