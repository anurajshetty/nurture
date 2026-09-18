/**
 * Onboarding state (Epic 1).
 *
 * `completed` is true once the user has finished or skipped onboarding —
 * derived from the durable kv flag OR the presence of an active pregnancy
 * row, so a second device that pulls the pregnancy down won't ask again.
 * `complete()` persists the pregnancy record locally, captures the device
 * timezone for future scheduling, marks onboarding done, and best-effort
 * pushes through the existing sync engine.
 */

import { useCallback, useEffect, useState } from 'react';
import { kvGet, kvSet } from '../lib/db';
import { savePregnancy, getActivePregnancy, type PregnancyInput } from '../sync/store';
import { syncNow } from '../sync/engine';
import { useAuth } from '../auth/AuthContext';
import type { Pregnancy } from '../lib/types';

export const ONBOARDING_COMPLETED_KEY = 'onboarding.completed';
const DEVICE_TIMEZONE_KEY = 'device.timezone';

/** The answers onboarding collects (all optional — skipping is first-class). */
export interface OnboardingDraft {
  dueDate: string | null; // YYYY-MM-DD
  lmpDate: string | null; // YYYY-MM-DD
  pregnancyType: Pregnancy['pregnancyType'];
  parity: Pregnancy['parity'];
}

export interface OnboardingValue {
  loading: boolean;
  completed: boolean;
  /** The active pregnancy row, when one exists locally. */
  pregnancy: Pregnancy | null;
  /** Persists the draft as the pregnancy record and marks onboarding done. Never throws. */
  complete: (draft: OnboardingDraft) => Promise<void>;
  /** Re-reads completion state from local storage. */
  refresh: () => void;
}

/** True when onboarding was finished or skipped on this device (or a pregnancy synced down). */
export function isOnboardingComplete(): boolean {
  try {
    if (kvGet(ONBOARDING_COMPLETED_KEY) === '1') return true;
    return getActivePregnancy() !== null;
  } catch {
    return false;
  }
}

export function useOnboarding(): OnboardingValue {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [pregnancy, setPregnancy] = useState<Pregnancy | null>(null);

  const refresh = useCallback(() => {
    try {
      setCompleted(isOnboardingComplete());
      setPregnancy(getActivePregnancy());
    } catch {
      // Local DB unreadable: stay on onboarding rather than crashing.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const complete = useCallback(
    async (draft: OnboardingDraft) => {
      const input: PregnancyInput = {
        userId: user?.id ?? null,
        dueDate: draft.dueDate,
        lmpDate: draft.lmpDate,
        pregnancyType: draft.pregnancyType,
        parity: draft.parity,
      };
      let saved: Pregnancy | null = null;
      try {
        saved = savePregnancy(input);
      } catch {
        // Local write failed: still let her into the app; the record just
        // won't exist yet. Never block entry.
      }
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) kvSet(DEVICE_TIMEZONE_KEY, tz);
      } catch {
        // Timezone capture is best-effort.
      }
      try {
        kvSet(ONBOARDING_COMPLETED_KEY, '1');
      } catch {
        // Non-fatal; the pregnancy row itself also marks completion.
      }
      setPregnancy(saved);
      setCompleted(true);
      // Best-effort push through the existing engine; local data is safe
      // regardless, and the outbox retries on the next sync.
      try {
        await syncNow();
      } catch {
        // Engine never throws, but never let sync block the celebration.
      }
    },
    [user],
  );

  return { loading, completed, pregnancy, complete, refresh };
}
