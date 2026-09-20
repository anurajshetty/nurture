import Svg, { Circle, G, Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';

/**
 * Logs-tab icon: clock (Anuraj, Sept 2026: "logs with clock is great" —
 * approved clock glyph replaces the ☰ text glyph).
 *
 * Spec (mockup 15 tab bar, locked): 24x24 viewBox, currentColor, 2px
 * round stroke — circle r=9 with hands "M12 7v5l3 3".
 *
 * `color` is the tab tint (active coral-deep / inactive muted),
 * supplied by useTabTint() in the tab shell, which derives focus from
 * the route.
 */
export function LogsTabIcon({ color, size = 24 }: { color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 7v5l3 3" />
      </G>
    </Svg>
  );
}
