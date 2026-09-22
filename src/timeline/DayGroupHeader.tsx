/**
 * Day-group section header — the feed's day grouping chrome (Anuraj,
 * Sept 2026): small uppercase muted label ("Today", "Yesterday",
 * "Friday, Sep 18"). Shared by the Logs feed (TimelineList, sticky) and
 * partner home (ScrollView) so the two surfaces can never disagree on
 * the labels' size, case, or color.
 */

import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import type { TimelineSection } from './timeline';

export default function DayGroupHeader({ section }: { section: TimelineSection }) {
  return (
    <View style={styles.daygroup} testID={`day-group-${section.key}`}>
      <Text style={styles.dayLabel}>{section.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  daygroup: {
    // Sticky section header: the cream background must cover the header's
    // FULL footprint. Backgrounds don't cover margins, so the spacing
    // around the text is padding (never margins) — otherwise cards
    // scrolling underneath show through the transparent margin zones when
    // the header sticks (Sept 2026 overlap bug).
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
    backgroundColor: colors.bg,
    zIndex: 1,
  },
  /** Small uppercase muted label — day groups are quiet navigation. */
  dayLabel: {
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.muted,
  },
});
