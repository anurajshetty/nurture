import Svg, { Circle, G } from 'react-native-svg';
import type { ColorValue } from 'react-native';

/**
 * Week-tab icon: target/bullseye (Anuraj, Sept 2026: "logs with clock
 * is great" — approved target glyph replaces the ◍ text glyph).
 *
 * Spec (mockup 15 tab bar, locked): 24x24 viewBox, currentColor, 2px
 * round stroke — two concentric circles, r=4 and r=9.
 *
 * `color` is the tab tint (active coral-deep / inactive muted),
 * supplied by useTabTint() in the tab shell, which derives focus from
 * the route.
 */
export function WeekTabIcon({ color, size = 24 }: { color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Circle cx="12" cy="12" r="4" />
        <Circle cx="12" cy="12" r="9" />
      </G>
    </Svg>
  );
}
