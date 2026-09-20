import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

/**
 * Ask Willow floating entry (Anuraj, Sept 20, 2026): Week tab only,
 * bottom-right coral 56pt pill labeled "ask" with the Willow mark.
 * Floats while the briefing scrolls. Not a card, not a fifth tab.
 */
function WillowMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round">
        <Circle cx="12" cy="4.4" r="2.1" fill="#FFFFFF" stroke="none" />
        <Path d="M11.8 7.6 C10.8 10 10 13.6 10.4 17.4" />
        <Path d="M13.4 9.4 C16 10.4 17.6 12.8 17.4 15.6 C17.2 18.2 15.4 19.8 13 19.6" />
        <Path d="M10.4 15.4 C11.6 17 14.2 17.4 16.2 16.2" />
      </G>
    </Svg>
  );
}

export function AskFab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="ask-fab"
      accessibilityRole="button"
      accessibilityLabel="Ask Willow about your pregnancy"
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
    >
      <WillowMark />
      <Text style={styles.label}>ask</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    minHeight: 56,
    paddingLeft: 17,
    paddingRight: 22,
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
