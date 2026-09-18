/**
 * Home — the keepsake timeline (Epic 2).
 *
 * Warm greeting + pregnancy week, the universal composer pinned at the
 * bottom, and the stream of saved moments above it. Entries appear
 * optimistically; Undo removes one. The end-of-day nudge is re-evaluated
 * whenever the stream changes or the screen regains focus.
 */

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Screen from '../../src/components/Screen';
import { colors, spacing, type as typeScale } from '../../src/theme/tokens';
import { listEvents } from '../../src/sync/store';
import type { LocalEvent } from '../../src/lib/types';
import { useOnboarding } from '../../src/onboarding/useOnboarding';
import { weekOf } from '../../src/onboarding/dates';
import Composer from '../../src/composer/Composer';
import EventCard from '../../src/composer/EventCard';
import { refreshEndOfDayNudge } from '../../src/notifications/endOfDay';
import { useSync } from '../../src/sync/SyncContext';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function dateLine(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function HomeScreen() {
  const { pregnancy } = useOnboarding();
  const dueDate = pregnancy?.dueDate ?? null;
  const { syncNow } = useSync();
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const week = dueDate ? weekOf(dueDate) : null;

  const reload = useCallback(() => {
    try {
      setEvents(listEvents(100));
    } catch {
      // The stream stays as-is on a read failure; composer still works.
    }
    void refreshEndOfDayNudge();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void syncNow()
      .catch(() => {})
      .finally(() => {
        reload();
        setRefreshing(false);
      });
  }, [reload, syncNow]);

  const onSaved = useCallback((event: LocalEvent) => {
    setEvents((prev) => [event, ...prev.filter((e) => e.id !== event.id)]);
  }, []);

  const onUnsaved = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return (
    <Screen scroll={false} testID="home-screen" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting()} ✦</Text>
        <Text style={styles.date}>
          {dateLine()}
          {week ? ` · Week ${week.week}` : ''}
        </Text>
      </View>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EventCard event={item} />}
        contentContainerStyle={styles.list}
        style={styles.stream}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your story starts here</Text>
            <Text style={styles.emptyBody}>
              Save a moment below — a thought, a photo, how you're feeling. It takes seconds.
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} />}
      />
      <View style={styles.composerWrap}>
        <Composer onSaved={onSaved} onUnsaved={onUnsaved} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  greeting: {
    ...typeScale.title,
    color: colors.ink,
  },
  date: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  stream: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typeScale.title,
    color: colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 24,
  },
  composerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});
