import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';

type EmptyStateProps = {
  /** Serif headline — warm, never clinical. */
  title: string;
  /** One or two sentences of gentle orientation. */
  copy: string;
  /** Small glyph shown in a blush medallion above the headline. */
  glyph?: string;
  /** Optional action (e.g. a Button) rendered below the copy. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Warm empty state: blush medallion, serif headline, muted guidance.
 * Centers in whatever space it's given — no fixed heights anywhere, so
 * Dynamic Type grows freely.
 */
export default function EmptyState({
  title,
  copy,
  glyph,
  children,
  style,
  testID,
}: EmptyStateProps) {
  return (
    <View testID={testID} style={[styles.wrap, style]}>
      {glyph ? (
        <View style={styles.medallion} accessibilityElementsHidden>
          <Text style={styles.glyph}>{glyph}</Text>
        </View>
      ) : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.copy}>{copy}</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.xxxl,
  },
  medallion: {
    width: 76,
    height: 76,
    borderRadius: radii.chip,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  glyph: {
    fontSize: 34,
    color: colors.coralDeep,
    lineHeight: 40,
  },
  title: {
    ...typeScale.title,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  copy: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
  actions: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
});
