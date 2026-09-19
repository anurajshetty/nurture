import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { SyncProvider } from '../src/sync/SyncContext';
import { useOnboarding } from '../src/onboarding/useOnboarding';
import { registerDefaultArchiveWriter, useMagicLinkHandler } from '../src/bootstrap';
import { ensureDbReady } from '../src/lib/db';
import { installTestHooks } from '../src/testhooks';
import { refreshEndOfDayNudge } from '../src/notifications/endOfDay';
import { colors } from '../src/theme/tokens';

/**
 * Chooses the first screen: onboarding until it's finished or skipped,
 * then the tab shell. Auth stays reachable via the auth route.
 */
function RootNavigator() {
  const { loading: authLoading } = useAuth();
  const { loading: onboardingLoading, completed } = useOnboarding();

  if (authLoading || onboardingLoading) {
    return (
      <View style={styles.splash} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* NOTE: keep <Stack.Screen> elements as direct children — never wrap
          them in a Fragment. expo-router's web Stack maps over children and
          warns on anything that isn't a Stack.Screen; interpolating a
          Fragment's Symbol type into that warning throws and blanks the app. */}
      {completed && <Stack.Screen name="(tabs)" />}
      {!completed && (
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      )}
      <Stack.Screen name="auth" />
      {/* Root landing redirect (Sept 2026): always registered — it sends
          finished onboarding to Week and everyone else to onboarding. */}
      <Stack.Screen name="index" />
      {completed && (
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      )}
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Root layout: safe-area + auth session + offline-first sync + onboarding
 * state, then the router. Warm cream behind every screen.
 *
 * The local database is awaited before anything renders: on web the SQLite
 * WASM module loads asynchronously, and every store below reads it
 * synchronously once mounted.
 */
export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureDbReady()
      .catch(() => {
        // ensureDbReady degrades to an in-memory DB rather than throwing;
        // boot anyway so she never stares at a spinner.
      })
      .finally(() => {
        if (!cancelled) {
          // Web-only test harness; self-guards on ?testhooks=1, no-op otherwise.
          installTestHooks();
          registerDefaultArchiveWriter();
          // Re-evaluate the end-of-day nudge at every boot: entry logged
          // today → no nudge; nothing logged → 8:30 PM trigger armed.
          // No-op on web.
          void refreshEndOfDayNudge();
          setDbReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useMagicLinkHandler();

  if (!dbReady) {
    return (
      <View style={styles.splash} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SyncProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
