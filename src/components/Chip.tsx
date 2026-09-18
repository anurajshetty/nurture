import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { chipHeight, colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * 48pt pill chip, 1.5pt border. Selected = blush fill + coral-deep text.
 * State is carried by text + fill, never color alone (accessibilityState).
 */
export default function Chip({
  label,
  selected = false,
  onPress,
  style,
  accessibilityLabel,
  testID,
}: ChipProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.idle,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.label, selected ? styles.labelSelected : styles.labelIdle]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(chipHeight, minTouch),
    borderRadius: radii.chip,
    borderWidth: 1.5,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idle: {
    backgroundColor: colors.card,
    borderColor: colors.line,
  },
  selected: {
    backgroundColor: colors.blush,
    borderColor: colors.coralDeep,
  },
  pressed: {
    opacity: 0.9,
  },
  label: {
    ...typeScale.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelIdle: {
    color: colors.ink,
  },
  labelSelected: {
    color: colors.coralDeep,
  },
});
