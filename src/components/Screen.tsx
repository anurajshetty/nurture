import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

type ScreenProps = {
  children: ReactNode;
  /** Scrollable content (default true). Turn off for fixed layouts. */
  scroll?: boolean;
  /** Extra space below the content — pass a larger value on tab screens so the tab bar never covers content. */
  bottomPadding?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The one screen wrapper. Warm cream background, safe-area aware, scrolls.
 * Text containers never get fixed heights — targets use minHeight so
 * Dynamic Type can grow without clipping.
 */
export default function Screen({
  children,
  scroll = true,
  bottomPadding = spacing.xxxl,
  style,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  if (!scroll) {
    return (
      <View
        testID={testID}
        style={[
          styles.root,
          { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.root, { paddingTop: insets.top }, style]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding + insets.bottom },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
});
