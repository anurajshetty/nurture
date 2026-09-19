/**
 * TEST-ONLY route: interactive harness mount for the journal sheet
 * (Epic 4, slice 4.2). Renders nothing useful unless the page URL carries
 * `?testhooks=1` — production users never reach it.
 *
 * Lets tests/interactive/epic4_journal_test.py drive the REAL JournalSheet
 * in real Chromium: open the sheet, type, attach a photo, save, and verify
 * the note lands on the timeline. Not part of the product surface; the
 * Plan tab (another Epic 4 track) owns the real entry point.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouch, spacing, type as typeScale } from '../src/theme/tokens';
import JournalSheet from '../src/logging/JournalSheet';

function testHooksEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const search = typeof window.location?.search === 'string' ? window.location.search : '';
  return search.includes('testhooks=1');
}

export default function JournalTestRoute() {
  const [allowed] = useState(testHooksEnabled);
  const [open, setOpen] = useState(false);

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Not available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Pressable
        testID="journal-test-open"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open journal"
        style={styles.openBtn}
      >
        <Text style={styles.openBtnText}>Open journal</Text>
      </Pressable>
      <JournalSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  openBtn: {
    minHeight: minTouch,
    paddingHorizontal: spacing.xxl,
    borderRadius: 18,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtnText: {
    ...typeScale.headline,
    color: '#fff',
  },
});
