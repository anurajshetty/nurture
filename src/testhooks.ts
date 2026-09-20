/**
 * Interactive web test harness hooks (Epic 3).
 *
 * ONLY activates when the page URL query includes `testhooks=1`
 * (e.g. https://…/willow/?testhooks=1). Production is never touched:
 * without the query param this module does nothing at all.
 *
 * Exposes `(window as any).__nurtureTest`:
 * - seedEvent(input) → saveEvent — inserts an event through the real store
 * - clearEvents() → clearAllEvents — resets the timeline
 * - completeOnboarding() — marks onboarding finished so the tab shell
 *   renders without walking the onboarding flow
 * - seedPregnancy(input) → savePregnancy — inserts a pregnancy record
 *   (used to exercise pregnancy-week bands and the week-jump button)
 */

import { clearAllEvents, saveEvent, savePregnancy } from './sync/store';
import { getDb, kvSet } from './lib/db';
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
        ownerName: input.ownerName ?? null,
        dob: input.dob ?? null,
        pregnancyType: input.pregnancyType ?? 'singleton',
        parity: input.parity ?? 'first',
      }),
    /** Last invite share target recorded by onboarding Screen 2 (kind + target). */
    lastInviteShare: null as { kind: string; target: string } | null,
    /**
     * Records the share target Screen 2 chose ('share-sheet' | 'mailto' |
     * 'sms' | 'web-link') so the interactive suite can assert the exact
     * handoff boundary. Reset by assigning lastInviteShare = null.
     */
    noteInviteShare: (kind: string, target: string) => {
      const api = (window as unknown as Record<string, unknown>).__nurtureTest as {
        lastInviteShare: { kind: string; target: string } | null;
      };
      api.lastInviteShare = { kind, target };
    },
    /** Marks all active pregnancies stopped (Epic 9 stop-state simulation). */
    stopPregnancy: () => {
      getDb().runSync(
        `UPDATE pregnancies SET status = 'stopped', updated_at = ? WHERE status = 'active'`,
        new Date().toISOString(),
      );
    },
    /**
     * Backdates an event's immutable created_at (appointment story-order
     * tests): lets the interactive suite seed appointments whose scheduled
     * date differs from the date they were logged.
     */
    setCreatedAt: (id: string, iso: string) => {
      getDb().runSync('UPDATE events SET created_at = ? WHERE id = ?', iso, id);
    },
  };
}
