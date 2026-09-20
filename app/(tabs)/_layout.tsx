import { useEffect } from 'react';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../src/theme/tokens';
import {
  installReminderSurfaces,
  takeColdStartAppointmentResponse,
} from '../../src/notifications/snooze';
import { refreshAppointmentReminders } from '../../src/notifications/appointments';

const TAB_GLYPHS = {
  week: '◍',
  logs: '☰',
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
 * Tab shell: Week · Logs · You. Warm tab bar, coral-deep active
 * tint, every target ≥48pt, no headers (each screen owns its title).
 * Week is the initial route, so it stays the default landing tab
 * (Anuraj, Sept 2026: the Home briefing screen was removed and Week
 * became the home/landing screen).
 *
 * The Plan tab was removed Sept 19, 2026 (Anuraj: tab bar is Week,
 * Logs, You). The Epic 6 reminder plumbing that used to mount on the
 * Plan screen (action-button categories, tap → view/snooze/pause/
 * dismiss handling, cold-start deep links, scheduling refresh on
 * focus) now mounts here so notification taps keep working without
 * the Plan screen.
 */
export default function TabsLayout() {
  const router = useRouter();

  // Epic 6 reminder surfaces: install once for the whole tab shell.
  useEffect(() => {
    // Deep link: notification taps and cold-start deep links land on
    // /logs?appointment=<id> — the Logs tab opens the appointment
    // editor for that event (AppointmentEditor, src/logs/).
    const viewAppointment = (id: string) =>
      router.push({ pathname: '/logs', params: { appointment: id } });
    const cleanup = installReminderSurfaces({
      onViewAppointment: viewAppointment,
    });
    void (async () => {
      const id = await takeColdStartAppointmentResponse();
      if (id) viewAppointment(id);
    })();
    return cleanup;
    // Mount-only: the listener must survive re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(() => {
    void refreshAppointmentReminders();
  });

  return (
    <Tabs
      initialRouteName="week"
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
        name="week"
        options={{
          title: 'Week',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.week} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'Logs',
          tabBarIcon: ({ focused }) => (
            <TabGlyph glyph={TAB_GLYPHS.logs} focused={focused} />
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
