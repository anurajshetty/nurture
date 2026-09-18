import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, minTouch, radii, shadow, spacing, type as typeScale } from '../theme/tokens';

type SegmentedProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Human-readable labels; falls back to the raw option value. */
  labels?: Partial<Record<T, string>>;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Pill container (#F1EAE0), options at 44pt min height. Selected = white
 * fill + coral-deep text + soft shadow. State announced via
 * accessibilityState — never color alone.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  accessibilityLabel,
  style,
  testID,
}: SegmentedProps<T>) {
  return (
    <View
      testID={testID}
      style={[styles.container, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityLabel={labels?.[option] ?? option}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && !selected && styles.optionPressed,
            ]}
          >
            <Text
              style={[
                styles.optionText,
                selected ? styles.optionTextSelected : styles.optionTextIdle,
              ]}
              numberOfLines={1}
            >
              {labels?.[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.segmentedBg,
    borderRadius: radii.chip,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  option: {
    flex: 1,
    minHeight: Math.max(44, minTouch - 4),
    borderRadius: radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: {
    backgroundColor: colors.card,
    ...shadow.card,
  },
  optionPressed: {
    opacity: 0.75,
  },
  optionText: {
    ...typeScale.subhead,
    fontWeight: '600',
    textAlign: 'center',
  },
  optionTextIdle: {
    color: colors.muted,
  },
  optionTextSelected: {
    color: colors.coralDeep,
  },
});
