/**
 * Willow design tokens — single source of truth.
 * Source: ~/workspace/app-ideas/pregnancy-tracker/design/DESIGN_NOTES.md
 * Rule: every control shares this component language. If a control can't be
 * expressed in these tokens, it doesn't ship until it can.
 * Warmth is the product: when in doubt, choose warm over clinical-clean.
 */

export const colors = {
  bg: '#FAF6F0', // warm cream app background
  card: '#FFFFFF', // cards, sheets
  ink: '#2F2B27', // primary text
  muted: '#8A8078', // secondary text
  coral: '#DE7A59', // primary action, active states
  coralDeep: '#C85F3E', // pressed / emphasis text on tint
  sage: '#93B192', // success, saved states, secondary
  sageDeep: '#6F8F6E', // text on sage tint
  blush: '#F6E7DD', // selected chips, tinted surfaces
  sageTint: '#EAF1E8', // saved confirmations, gentle highlights
  line: '#ECE5DA', // borders, dividers
  blue: '#7FA8C9', // photo/video icon dots
  gold: '#C9A227', // milestone/kick icon dots
  lilac: '#8E7CC3', // appointment icon dots
  blueTint: '#E3ECF5', // video attach icon tile
  goldTint: '#FAF3DF', // baby-tile tint (BriefingScreen delight tile)
  toggleOff: '#D9CFC0',
  segmentedBg: '#F1EAE0',
} as const;

export const radii = {
  button: 18,
  chip: 999, // pill
  card: 20,
  cardLarge: 22,
  sheet: 24, // top radius for bottom sheets
  docPreview: 8,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Minimum touch target: 48pt everywhere (exceeds the 44pt baseline). */
export const minTouch = 48;

export const buttonHeight = 56;
export const chipHeight = 48;

/** Display = serif for screen titles, week bands, keepsake moments. */
export const fontDisplay = 'Georgia';
/** Body/UI = system sans. In React Native, undefined = system font. */
export const fontBody = undefined;

export const type = {
  display: { fontFamily: fontDisplay, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fontDisplay, fontSize: 22, lineHeight: 28 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22 },
  subhead: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12.5, lineHeight: 16 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
} as const;

/** Event-type dot colors shared by timeline cards and filter chips. */
export const eventDots = {
  note: colors.coral,
  photo: colors.blue,
  symptom: colors.coral,
  mood: colors.sage,
  weight: colors.muted,
  appointment: colors.lilac,
  kick: colors.gold,
  milestone: colors.gold,
  question: colors.blue,
  file: colors.muted,
  report: colors.blue,
} as const;

export type EventDotKind = keyof typeof eventDots;

export const theme = {
  colors,
  radii,
  spacing,
  minTouch,
  buttonHeight,
  chipHeight,
  type,
  shadow,
  eventDots,
  fontDisplay,
} as const;

export type Theme = typeof theme;
