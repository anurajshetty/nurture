import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components';
import JournalSheet from '../../src/logging/JournalSheet';
import { colors, eventDots, spacing, type as typeScale } from '../../src/theme/tokens';

/**
 * Plan (Epic 4): home for structured logging. The Journal tile opens the
 * journal sheet (Anuraj-approved round 6); further log types arrive with
 * their own approved sheets.
 */
export default function PlanScreen() {
  const [journalOpen, setJournalOpen] = useState(false);
  const white = '#FFFFFF';

  return (
    <Screen bottomPadding={120} testID="plan-screen">
      <Text style={styles.heading}>Plan</Text>
      <Text style={styles.kicker}>Log something</Text>
      <Pressable
        onPress={() => setJournalOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Journal"
        testID="plan-tile-journal"
        style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      >
        <View style={[styles.icon, { backgroundColor: eventDots.note }]}>
          <Text style={[styles.iconGlyph, { color: white }]}>✎</Text>
        </View>
        <View style={styles.tileText}>
          <Text style={styles.tileTitle}>Journal</Text>
          <Text style={styles.tileSub}>A few lines, just for you</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>
      <JournalSheet visible={journalOpen} onClose={() => setJournalOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typeScale.display,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    paddingLeft: 12,
    marginBottom: spacing.sm,
    minHeight: 72,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  tilePressed: {
    opacity: 0.96,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 22,
    fontWeight: '700',
  },
  tileText: {
    flex: 1,
  },
  tileTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  tileSub: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
    marginTop: 2,
  },
  chev: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
  },
});
