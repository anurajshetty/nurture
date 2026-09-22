import { useEffect } from 'react';
import { Tabs, useFocusEffect, useRouter, useSegments } from 'expo-router';
import { StyleSheet } from 'react-native';
import type { ColorValue } from 'react-native';
import { colors, spacing } from '../../src/theme/tokens';
import { YouTabIcon } from '../../src/components/YouTabIcon';
import { WeekTabIcon } from '../../src/components/WeekTabIcon';
import { LogsTabIcon } from '../../src/components/LogsTabIcon';
import {
  installReminderSurfaces,
  takeColdStartAppointmentResponse,
} from '../../src/notifications/snooze';
import { refreshAppointmentReminders } from '../../src/notifications/appointments';

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

function WeekTabBarIcon() {
  const color = useTabTint('week');
  return <WeekTabIcon size={22} color={color} />;
}

function LogsTabBarIcon() {
  const color = useTabTint('logs');
  return <LogsTabIcon size={22} color={color} />;
}

function YouTabBarIcon() {
  const color = useTabTint('you');
  return <YouTabIcon size={22} color={color} />;
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
          tabBarIcon: () => <WeekTabBarIcon />,
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'Logs',
          tabBarIcon: () => <LogsTabBarIcon />,
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
  /**
   * Slimmer tab bar (Anuraj, Sept 2026): tighter vertical padding,
   * smaller icons/labels, so more feed fits on screen. Every tab
   * target stays ≥44pt (item minHeight 48). Active coral / inactive
   * muted tints unchanged; no navigation-behavior change.
   */
  bar: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    minHeight: 68,
  },
  item: {
    minHeight: 48,
    paddingVertical: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
});
