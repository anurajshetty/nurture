/**
 * TEST-ONLY route: interactive harness mount for the briefing screen
 * (track 2: briefing UI). Renders nothing useful unless the page URL
 * carries `?testhooks=1` — production users never reach it.
 *
 * Wraps the REAL BriefingScreen in the test-only override provider and
 * exposes `window.__briefingTest = { setStatus(s), seedBriefing(b) }`, so
 * tests/interactive/home_briefing_test.py can force each BriefingStatus
 * (live / generating / offline / empty) with seeded content without
 * touching the real refresh pipeline. Never hits any real API.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type as typeScale } from '../src/theme/tokens';
import { BriefingScreen } from '../src/briefing/BriefingScreen';
import { BriefingTestOverrideContext, type BriefingTestOverride } from '../src/briefing/testSeam';
import type { Briefing, BriefingStatus } from '../src/briefing/types';

function testHooksEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const search = typeof window.location?.search === 'string' ? window.location.search : '';
  return search.includes('testhooks=1');
}

export default function BriefingTestRoute() {
  const [allowed] = useState(testHooksEnabled);
  const [override, setOverride] = useState<BriefingTestOverride>({
    status: 'empty',
    briefing: null,
  });

  useEffect(() => {
    if (!allowed || typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__briefingTest = {
      setStatus: (s: BriefingStatus) =>
        setOverride((prev) => ({ ...prev, status: s })),
      seedBriefing: (b: Briefing | null) =>
        setOverride((prev) => ({ ...prev, briefing: b })),
    };
  }, [allowed]);

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Not available.</Text>
      </View>
    );
  }

  return (
    <View testID="briefing-test-root" style={styles.root}>
      <BriefingTestOverrideContext.Provider value={override}>
        <BriefingScreen />
      </BriefingTestOverrideContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  muted: {
    ...typeScale.body,
    color: colors.muted,
  },
});
