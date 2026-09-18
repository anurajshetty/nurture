import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';

type SettingsRowProps = {
  /** Glyph rendered in the 46pt tinted tile (e.g. "✦", "♥"). */
  icon: string;
  /** Tile background — a token tint. Defaults to blush. */
  tint?: string;
  /** Glyph color inside the tile. Defaults to coral-deep. */
  tintInk?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned value text (e.g. "8:30 PM"). Replaces the chevron unless `trailing` is set. */
  value?: string;
  /** Custom trailing control (Toggle, stepper…). Replaces the chevron. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * One family for every settings / log-type row: 46pt tinted icon tile,
 * label + muted sub-label, chevron (or value / custom control) at right.
 * Rows with onPress are buttons; rows with `trailing` keep the control as
 * the interactive element.
 */
export default function SettingsRow({
  icon,
  tint = colors.blush,
  tintInk = colors.coralDeep,
  title,
  subtitle,
  value,
  trailing,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: SettingsRowProps) {
  const body = (
    <>
      <View style={[styles.tile, { backgroundColor: tint }]} accessibilityElementsHidden>
        <Text style={[styles.tileGlyph, { color: tintInk }]}>{icon}</Text>
      </View>
      <View style={styles.labels}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? (
        <View style={styles.trailing}>{trailing}</View>
      ) : value ? (
        <Text style={styles.value}>{value}</Text>
      ) : onPress ? (
        <Text style={styles.chevron} accessibilityElementsHidden>
          ›
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={[styles.row, style]} accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    minHeight: 68,
    ...shadow.card,
  },
  pressed: {
    opacity: 0.92,
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  labels: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typeScale.headline,
    color: colors.ink,
  },
  subtitle: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  value: {
    ...typeScale.body,
    color: colors.muted,
    fontWeight: '600',
  },
  trailing: {
    marginLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  chevron: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.muted,
    marginLeft: spacing.xs,
  },
});
