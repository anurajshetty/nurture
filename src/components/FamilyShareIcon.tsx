/**
 * FamilyShareIcon — the read-only sharing status indicator (mockup 33B,
 * Anuraj approved Sept 21, 2026; final art picked Sept 21, 2026:
 * option C — "ink on blush").
 *
 * An ink (#2F2B27) family glyph (two adults + little one) centered on a
 * soft blush (#F6E7DD) filled circle, transparent outside the circle.
 * Non-interactive: a status indicator, NOT a control — no tap target, no
 * pressable. Shown only on shared entries, top-right of the card,
 * immediately left of the delete ×.
 *
 * No emoji anywhere: the 👪 emoji renders with a grey box on some
 * platforms. This is a hand-drawn vector (reference:
 * design/family-icon-samples.html, option C 24px markup).
 */

import { View, type ViewStyle } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { colors } from '../theme/tokens';

export interface FamilyShareIconProps {
  /** Rendered size in points (width = height). Default 24. */
  size?: number;
  /** Extra style on the wrapping view (e.g. absolute positioning). */
  style?: ViewStyle;
  /** Accessibility label override. */
  label?: string;
  /** testID for regression tests. */
  testID?: string;
}

export default function FamilyShareIcon({
  size = 24,
  style,
  label = 'Shared with partners',
  testID = 'family-share-icon',
}: FamilyShareIconProps) {
  return (
    <View
      style={[{ width: size, height: size }, style]}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle cx="24" cy="24" r="22" fill={colors.blush} />
        <Circle cx="17" cy="16" r="4.4" fill={colors.ink} />
        <Path
          d="M17 22c-4 0-7.2 3.2-7.2 7.1V38h14.4v-8.9c0-3.9-3.2-7.1-7.2-7.1z"
          fill={colors.ink}
        />
        <Circle cx="31" cy="16" r="4.4" fill={colors.ink} />
        <Path
          d="M31 22c-4 0-7.2 3.2-7.2 7.1V38h14.4v-8.9c0-3.9-3.2-7.1-7.2-7.1z"
          fill={colors.ink}
        />
        {/* Little one's head: blush cutout first so the adults read
            behind it, then the ink head — matches the approved option-C
            markup. */}
        <Circle cx="24" cy="28.5" r="3" fill={colors.blush} />
        <Circle cx="24" cy="28.5" r="3" fill={colors.ink} />
        <Path
          d="M24 32.6c-2.7 0-4.9 2.2-4.9 4.9V38h9.8v-.5c0-2.7-2.2-4.9-4.9-4.9z"
          fill={colors.ink}
        />
      </Svg>
    </View>
  );
}
