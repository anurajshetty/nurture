import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoid } from './KeyboardAvoid';
import { colors, spacing } from '../theme/tokens';

type ScreenProps = {
  children: ReactNode;
  /** Scrollable content (default true). Turn off for fixed layouts. */
  scroll?: boolean;
  /** Extra space below the content — pass a larger value on tab screens so the tab bar never covers content. */
  bottomPadding?: number;
  /**
   * iOS keyboard avoidance (default true). The whole screen lifts above
   * the keyboard via the shared KeyboardAvoid pattern. Opt OUT only
   * when the surface manages its own avoidance (e.g. the Logs tab, whose
   * FloatingComposer wraps its own card).
   */
  keyboardAvoid?: boolean;
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
  keyboardAvoid = true,
  style,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const content = scroll ? (
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
  ) : (
    children
  );

  const rootStyle: StyleProp<ViewStyle> = scroll
    ? [styles.root, { paddingTop: insets.top }, style]
    : [
        styles.root,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) },
        style,
      ];

  return (
    <View testID={testID} style={rootStyle}>
      {keyboardAvoid ? (
        <KeyboardAvoid style={styles.avoid}>{content}</KeyboardAvoid>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  /** KeyboardAvoid must fill the screen for the padding shift to work. */
  avoid: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
});
