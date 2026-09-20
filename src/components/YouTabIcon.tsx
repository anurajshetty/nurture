import Svg, { Circle, G, Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';

/**
 * You-tab icon, v3 "bowed mother" (Anuraj, Sept 19 2026: "Let's go with
 * this for now."). Replaces the ☺ text glyph.
 *
 * Spec: 24x24 viewBox, currentColor, 2px round stroke caps.
 * - hair bun outline circle + bowed head filled dot down-forward of the
 *   bun + flowing back curve + round belly + cradle-under curve.
 *
 * `color` is the tab tint (active coral-deep / inactive muted), the
 * currentColor equivalent — supplied by useTabTint() in the tab shell,
 * which derives focus from the route.
 */
export function YouTabIcon({ color, size = 24 }: { color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Circle cx="8.8" cy="3" r="1.4" />
        <Circle cx="12" cy="8" r="1.9" fill={color} stroke="none" />
        <Path d="M10.6 9.6 C8.6 11.4 7.9 15 9.1 18.8 C9.6 20.4 9.3 21.5 8.7 22.3" />
        <Path d="M13.4 11.6 C15.9 12.7 17.4 15 17.2 17.6 C17 20 15 21.6 12.8 21.4" />
        <Path d="M9.6 16.6 C11.1 18.5 14.5 19 16.8 17.5" />
      </G>
    </Svg>
  );
}
