/**
 * Week filter dropdown — Logs tab header (Anuraj-approved, Sept 2026).
 *
 * The week pill is a FILTER, not a jump: tapping it opens this inline
 * panel ("All weeks" + Week N, newest first). A selected week shows only
 * that week's divider + entries; "All weeks" shows everything. The pill
 * label always matches the shown content — the old Week-37-pill vs
 * Week-38-divider bug came from the pill and the dividers using two
 * different week calculations (now unified via currentPregnancyWeek).
 *
 * Panel is inline in the header flow (not a bottom sheet); the option
 * list scrolls with a 7-row cap so it stays compact even at week 40+.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, shadow, spacing } from '../theme/tokens';

export type WeekFilterValue = 'all' | number;

type Props = {
  visible: boolean;
  /** Current 1-based pregnancy week; null hides the week options. */
  currentWeek: number | null;
  value: WeekFilterValue;
  onSelect: (v: WeekFilterValue) => void;
  testID?: string;
};

const OPTION_HEIGHT = 44;

export default function WeekFilterDropdown({
  visible,
  currentWeek,
  value,
  onSelect,
  testID = 'week-filter-dropdown',
}: Props) {
  if (!visible) return null;
  const weeks: number[] = [];
  if (currentWeek !== null) {
    for (let w = currentWeek; w >= 1; w -= 1) weeks.push(w);
  }
  return (
    <View
      style={styles.wrap}
      testID={testID}
      accessibilityRole="list"
      accessibilityLabel="Choose week"
    >
      <ScrollView style={styles.list} nestedScrollEnabled>
        <WeekOption
          label="All weeks"
          selected={value === 'all'}
          onPress={() => onSelect('all')}
          testID="week-filter-option-all"
        />
        {weeks.map((w) => (
          <WeekOption
            key={w}
            label={`Week ${w}`}
            selected={value === w}
            onPress={() => onSelect(w)}
            testID={`week-filter-option-${w}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function WeekOption({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={[styles.option, selected && styles.optionSelected]}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
      {selected && <Text style={styles.check}>✓</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14, // matches approved mockup panel
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow,
  },
  list: {
    maxHeight: OPTION_HEIGHT * 7,
  },
  option: {
    minHeight: OPTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  optionSelected: {
    backgroundColor: colors.blush,
  },
  optionLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.ink,
  },
  optionLabelSelected: {
    color: colors.coralDeep,
  },
  check: {
    marginLeft: 'auto',
    fontSize: 15,
    fontWeight: '700',
    color: colors.coralDeep,
  },
});
