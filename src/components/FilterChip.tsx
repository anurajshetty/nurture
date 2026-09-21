import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  chipHeight,
  colors,
  eventDots,
  minTouch,
  radii,
  spacing,
  type as typeScale,
  type EventDotKind,
} from '../theme/tokens';

export type FilterKind = EventDotKind | 'all';

/** Glyphs rendered inside the type dot — one family shared with timeline cards. */
const GLYPHS: Record<FilterKind, string> = {
  all: '✳',
  note: '✎',
  photo: '◉',
  symptom: '✚',
  mood: '♥',
  weight: '◍',
  appointment: '▤',
  kick: '✦',
  activity: '❀',
  milestone: '★',
  question: '?',
  file: '≣',
  report: '📄',
};

const DOT_COLORS: Record<FilterKind, string> = {
  ...eventDots,
  all: colors.muted,
};

type FilterChipProps = {
  kind: FilterKind;
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Override the default glyph for this kind. */
  glyph?: string;
  /**
   * Tighter 44pt pill (13px label, 20px dot) for dense header rows —
   * the Logs filter row per the approved 13-logs-add mockup. Opt-in so
   * other surfaces keep the standard 48pt chip.
   */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Icon + label filter chip (48pt pill). The dot reuses the card type dot —
 * same glyph, same color — so the filter row reads as a legend of the
 * stream below. Unselected = white fill, line border, ink text; selected =
 * blush fill, coral-deep text and border.
 */
export default function FilterChip({
  kind,
  label,
  selected = false,
  onPress,
  glyph,
  compact = false,
  style,
  testID,
}: FilterChipProps) {
  const dotColor = DOT_COLORS[kind];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        compact && styles.baseCompact,
        selected ? styles.selected : styles.idle,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.dot, compact && styles.dotCompact, { backgroundColor: dotColor }]}>
        <Text style={[styles.glyph, compact && styles.glyphCompact]}>{glyph ?? GLYPHS[kind]}</Text>
      </View>
      <Text
        style={[
          styles.label,
          compact && styles.labelCompact,
          selected ? styles.labelSelected : styles.labelIdle,
        ]}>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  /** Compact variant: 44pt pill, tighter padding — mockup 13-logs-add. */
  baseCompact: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 8,
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
  dot: {
    width: 24,
    height: 24,
    borderRadius: radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCompact: {
    width: 20,
    height: 20,
  },
  glyph: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '700',
  },
  glyphCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  label: {
    ...typeScale.body,
    fontWeight: '600',
  },
  labelCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  labelIdle: {
    color: colors.ink,
  },
  labelSelected: {
    color: colors.coralDeep,
  },
});
