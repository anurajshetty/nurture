/**
 * WeekPicker (Epic 3.1).
 *
 * The "Week N ▾" jump button opens this as a bottom sheet listing every
 * pregnancy week up to the current one, newest first — a week in 2 taps.
 *
 * Note: the approved v1 mockup (design/03-timeline.html) only annotates
 * this as "jump to any week in 2 taps" with no detailed picker design;
 * this sheet follows the mockup's week-band visual language (serif week
 * title + muted date range, same as the timeline headers) so Anuraj can
 * review the real thing.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomSheet from '../components/BottomSheet';
import { colors, fontDisplay, minTouch, spacing, type as typeScale } from '../theme/tokens';

export interface WeekPickerWeek {
  week: number;
  title: string;
  subtitle: string;
}

interface WeekPickerProps {
  visible: boolean;
  onClose(): void;
  weeks: WeekPickerWeek[];
  currentWeek: number | null;
  onPick(week: number): void;
}

export default function WeekPicker({
  visible,
  onClose,
  weeks,
  currentWeek,
  onPick,
}: WeekPickerProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      testID="week-picker"
      accessibilityLabel="Jump to a week"
    >
      <Text style={styles.title}>Jump to a week</Text>
      <Text style={styles.hint}>Two taps — pick a week and you're there.</Text>
      <ScrollView style={styles.rows} showsVerticalScrollIndicator={false}>
        {weeks.map((w) => {
          const current = w.week === currentWeek;
          return (
            <Pressable
              key={w.week}
              testID={`week-row-${w.week}`}
              accessibilityRole="button"
              accessibilityLabel={`${w.title}${current ? ', current week' : ''}`}
              onPress={() => onPick(w.week)}
              style={({ pressed }) => [
                styles.row,
                current && styles.rowCurrent,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={[styles.rowTitle, current && styles.rowTitleCurrent]}>
                {w.title}
              </Text>
              <Text style={styles.rowSubtitle}>{w.subtitle}</Text>
              {current && <Text style={styles.youAreHere}>You're here</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fontDisplay,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    color: colors.ink,
  },
  hint: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  rows: {
    maxHeight: 420,
  },
  row: {
    minHeight: minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.sm,
  },
  rowCurrent: {
    backgroundColor: colors.blush,
    borderColor: colors.coral,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowTitle: {
    fontFamily: fontDisplay,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.ink,
    minWidth: 76,
  },
  rowTitleCurrent: {
    color: colors.coralDeep,
  },
  rowSubtitle: {
    ...typeScale.subhead,
    color: colors.muted,
    flex: 1,
  },
  youAreHere: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    fontWeight: '700',
  },
});
