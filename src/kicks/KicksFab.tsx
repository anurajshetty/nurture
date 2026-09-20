/**
 * Kick counter floating entry (Willow, Anuraj approved Sept 20, 2026).
 *
 * Coral 96×56 pill labeled "kicks" with a creative baby-foot mark (not
 * the Willow mark). Same footprint and right edge as the Ask pill,
 * stacked 12pt above it. Week tab only, displayed week 19+. Opens the
 * full-screen counting screen.
 */

import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

/** A baby foot: five toes, a sole, two motion lines. White on coral. */
function FootMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round">
        <Path d="M3.4 9.4l2.9.9" />
        <Path d="M2.8 14.1l2.9.3" />
      </G>
      <G fill="#FFFFFF">
        <Circle cx={9} cy={7.2} r={2.1} />
        <Circle cx={12.3} cy={5.7} r={1.7} />
        <Circle cx={15.6} cy={5.5} r={1.6} />
        <Circle cx={18.7} cy={6.5} r={1.4} />
        <Circle cx={21.1} cy={8} r={1.2} />
        <Ellipse cx={13.4} cy={15.6} rx={5.1} ry={5.6} />
      </G>
    </Svg>
  );
}

export function KicksFab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="kicks-fab"
      accessibilityRole="button"
      accessibilityLabel="Count kicks"
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
    >
      <FootMark />
      <Text style={styles.label}>kicks</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    // 12pt above the Ask pill (Ask sits at bottom:18, 56pt tall).
    bottom: 86,
    minWidth: 96,
    minHeight: 56,
    paddingLeft: 17,
    paddingRight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.coral,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: {
    backgroundColor: colors.coralDeep,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
