import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../src/theme/tokens';

const TAB_GLYPHS = {
  index: '⌂',
  week: '◍',
  plan: '▤',
  you: '☺',
} as const;

function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text
      style={[styles.glyph, focused ? styles.glyphFocused : styles.glyphIdle]}
      accessibilityElementsHidden
    >
      {glyph}
    </Text>
  );
}

/**
 * Tab shell: Home · Week · Plan · You. Warm tab bar, coral-deep active
 * tint, every target ≥48pt, no headers (each screen owns its title).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.coralDeep,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.index} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: 'Week',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.week} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.plan} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.you} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    minHeight: 84,
  },
  item: {
    minHeight: 56,
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  glyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  glyphFocused: {
    color: colors.coralDeep,
  },
  glyphIdle: {
    color: colors.muted,
  },
});
