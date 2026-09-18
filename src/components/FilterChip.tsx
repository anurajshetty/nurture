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
  milestone: '★',
  question: '?',
  file: '≣',
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
        selected ? styles.selected : styles.idle,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]}>
        <Text style={styles.glyph}>{glyph ?? GLYPHS[kind]}</Text>
      </View>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  glyph: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '700',
  },
  label: {
    ...typeScale.body,
    fontWeight: '600',
  },
  labelIdle: {
    color: colors.ink,
  },
  labelSelected: {
    color: colors.coralDeep,
  },
});
