/**
 * Breathing-section icons (Willow, Sept 2026).
 *
 * Inline stroke icons in the Nurture component language: 24x24 viewBox,
 * currentColor-driven, 2px round stroke. Glyphs match design mockup 28.
 * Every icon takes an explicit `color` — nothing inherits (iOS Safari
 * paints unstyled glyph text system-blue; explicit colors everywhere).
 */
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';
import type { ReactNode } from 'react';
import { colors } from '../../theme/tokens';

type IconProps = { color?: ColorValue; size?: number };

function Base({
  color = colors.coralDeep,
  size = 26,
  children,
  strokeWidth = 2,
}: IconProps & { children: ReactNode; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </G>
    </Svg>
  );
}

export function ChevronLeftIcon({ color = colors.ink, size = 22 }: IconProps) {
  return (
    <Base color={color} size={size} strokeWidth={2.4}>
      <Path d="M15 5l-7 7 7 7" />
    </Base>
  );
}

/** Cleansing breath tile */
export function WindIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M3 8h9a3 3 0 1 0-3-3" />
      <Path d="M3 12h13a3 3 0 1 1-3 3" />
      <Path d="M3 16h6" />
    </Base>
  );
}

/** Slow-paced breathing tile */
export function WaveIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M2 12c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 5 4" />
    </Base>
  );
}

/** Light breathing tile */
export function FeatherIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M20 4c-6 0-12 4-13 11l-3 5" />
      <Path d="M20 4c1 6-3 12-11 13" />
      <Path d="M7 20c2-4 5-8 9-10" />
    </Base>
  );
}

/** Patterned breathing tile */
export function RhythmIcon(props: IconProps) {
  return (
    <Base {...props}>
      <Path d="M5 18v-6" />
      <Path d="M10 18v-9" />
      <Path d="M15 18V8" />
      <Path d="M20 18v-4" />
      <Circle cx="5" cy="9" r="1.6" fill={props.color ?? colors.coralDeep} stroke="none" />
      <Circle cx="10" cy="6" r="1.6" fill={props.color ?? colors.coralDeep} stroke="none" />
      <Circle cx="20" cy="11" r="1.6" fill={props.color ?? colors.coralDeep} stroke="none" />
    </Base>
  );
}

export function MoonIcon({ color = colors.coralDeep, size = 20 }: IconProps) {
  return (
    <Base color={color} size={size}>
      <Path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </Base>
  );
}

export function SunIcon({ color = colors.coralDeep, size = 20 }: IconProps) {
  return (
    <Base color={color} size={size}>
      <Circle cx="12" cy="12" r="4" />
      <Path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </Base>
  );
}

/** Haptic pulse switch glyph */
export function BuzzIcon({ color = colors.muted, size = 20 }: IconProps) {
  return (
    <Base color={color} size={size}>
      <Rect x="8" y="3" width="8" height="18" rx="2.5" />
      <Path d="M4 9l-1.5-1.5M4 15l-1.5 1.5M20 9l1.5-1.5M20 15l1.5 1.5" />
    </Base>
  );
}

/** Soft tone switch glyph */
export function BellIcon({ color = colors.muted, size = 20 }: IconProps) {
  return (
    <Base color={color} size={size}>
      <Path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z" />
      <Path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </Base>
  );
}

export function CheckIcon({ size = 40 }: { size?: number }) {
  return (
    <Base color={colors.sageDeep} size={size} strokeWidth={2.6}>
      <Path d="M4 12.5l5 5L20 6.5" />
    </Base>
  );
}
