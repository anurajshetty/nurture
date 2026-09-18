import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { buttonHeight, colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';

type ButtonProps = {
  title: string;
  onPress: () => void;
  /** primary = coral fill · ghost = white fill, coral-deep text, hairline border */
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * 56pt coral button, 18pt radius. Ghost variant for secondary actions.
 * Uses minHeight (never fixed height) so larger Dynamic Type wraps instead
 * of clipping.
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const ghost = variant === 'ghost';
  const inactive = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive }}
      style={({ pressed }) => [
        styles.base,
        ghost ? styles.ghost : styles.primary,
        pressed && !inactive && (ghost ? styles.ghostPressed : styles.primaryPressed),
        inactive && styles.inactive,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          ghost ? styles.ghostText : styles.primaryText,
          textStyle,
        ]}
        numberOfLines={2}
      >
        {loading ? 'A moment…' : title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(buttonHeight, minTouch),
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  primary: {
    backgroundColor: colors.coral,
  },
  primaryPressed: {
    backgroundColor: colors.coralDeep,
  },
  ghost: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  ghostPressed: {
    backgroundColor: colors.blush,
    borderColor: colors.coral,
  },
  inactive: {
    opacity: 0.55,
  },
  text: {
    ...typeScale.headline,
    textAlign: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  ghostText: {
    color: colors.coralDeep,
  },
});
