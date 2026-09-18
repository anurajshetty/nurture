import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii, shadow, spacing } from '../theme/tokens';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Makes the whole card tappable. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

/** White card, 20pt radius, soft shadow. The app's workhorse surface. */
export default function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: CardProps) {
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadow.card,
  },
  pressed: {
    opacity: 0.96,
  },
});
