import { useEffect } from 'react';
import { Tabs, useFocusEffect, useRouter, useSegments } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { colors, spacing } from '../../src/theme/tokens';
import { YouTabIcon } from '../../src/components/YouTabIcon';
import {
  installReminderSurfaces,
  takeColdStartAppointmentResponse,
} from '../../src/notifications/snooze';
import { refreshAppointmentReminders } from '../../src/notifications/appointments';

const TAB_GLYPHS = {
  week: '◍',
  logs: '☰',
} as const;

type TabName = 'week' | 'logs' | 'you';

/**
 * Active-tab tint, derived from the route (not the tabBarIcon callback
 * props). The tabBarIcon `focused`/`color` props are not reliably
 * per-tab on web (Expo 57: every tab's icon renders with the active
 * tint), while the route always reflects the focused tab — on every
 * platform. Verified Sept 2026.
 */
function useTabTint(tab: TabName): ColorValue {
  const segments = useSegments();
  const here = segments.filter((s) => !s.startsWith('(')).pop();
  return here === tab ? colors.coralDeep : colors.muted;
}

function TabGlyph({ tab, glyph }: { tab: 'week' | 'logs'; glyph: string }) {
  const color = useTabTint(tab);
  return (
    <Text style={[styles.glyph, { color }]} accessibilityElementsHidden>
      {glyph}
    </Text>
  );
}

function YouTabBarIcon() {
  const color = useTabTint('you');
  return <YouTabIcon color={color} />;
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
          tabBarIcon: () => <TabGlyph tab="week" glyph={TAB_GLYPHS.week} />,
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'Logs',
          tabBarIcon: () => <TabGlyph tab="logs" glyph={TAB_GLYPHS.logs} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: () => <YouTabBarIcon />,
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
});
