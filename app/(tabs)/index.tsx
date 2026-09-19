/**
 * Home — the keepsake timeline (Epic 3).
 *
 * "Your story" header with the Week N ▾ jump button (week picker in a
 * bottom sheet), the filter chip row (track 2), and the virtualized
 * timeline (week bands, newest first) with the memory look-back card
 * (track 3) pinned above it. The composer stays pinned at the bottom;
 * entries appear optimistically and Undo removes one. Look-back is
 * computed on focus, dismissible, and never a push. The end-of-day nudge
 * is re-evaluated whenever the stream changes or the screen regains focus.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Screen from '../../src/components/Screen';
import {
  colors,
  fontDisplay,
  spacing,
  type as typeScale,
} from '../../src/theme/tokens';
import { countEvents, listEventsInRange, listEventsPage } from '../../src/sync/store';
import { kvGet, kvSet } from '../../src/lib/db';
import type { LocalEvent } from '../../src/lib/types';
import { useOnboarding } from '../../src/onboarding/useOnboarding';
import { weekOf } from '../../src/onboarding/dates';
import Composer from '../../src/composer/Composer';
import { refreshEndOfDayNudge } from '../../src/notifications/endOfDay';
import { useSync } from '../../src/sync/SyncContext';
import TimelineFilters, {
  matchesFilter,
  type FilterValue,
} from '../../src/timeline/TimelineFilters';
import TimelineList from '../../src/timeline/TimelineList';
import WeekPicker, { type WeekPickerWeek } from '../../src/timeline/WeekPicker';
import { buildSections, formatWeekRange, pregnancyWeekRange } from '../../src/timeline/timeline';
import type { TimelineSection } from '../../src/timeline/timeline';
import {
  chooseLookBack,
  lookBackWeekKey,
  lookBackWindow,
  type LookBack,
} from '../../src/timeline/lookback';

/** One timeline page; keeps 9 months of daily data smooth. */
const PAGE_SIZE = 60;

export default function HomeScreen() {
  const { pregnancy } = useOnboarding();
  const dueDate = pregnancy?.dueDate ?? null;
  const { syncNow } = useSync();

  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [lookBack, setLookBack] = useState<LookBack | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const sectionListRef = useRef<SectionList<LocalEvent, TimelineSection> | null>(null);
  const loadingMore = useRef(false);

  const week = dueDate ? weekOf(dueDate) : null;

  const reload = useCallback(() => {
    try {
      setEvents(listEventsPage(PAGE_SIZE, 0));
    } catch {
      // The stream stays as-is on a read failure; composer still works.
    }
    // Memory look-back, computed on focus (track 3): an event from the
    // same window a few weeks ago. Dismissible per week via the kv store;
    // the card only ever renders when the "All" filter is showing.
    try {
      const { startISO, endISO } = lookBackWindow(new Date());
      const lb = chooseLookBack(listEventsInRange(startISO, endISO, 50), new Date());
      const dismissed = kvGet(`lookback.dismissed.${lookBackWeekKey(new Date())}`) === '1';
      setLookBack(dismissed ? null : lb);
    } catch {
      setLookBack(null);
    }
    void refreshEndOfDayNudge();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /** Loads the next page while fewer rows are in memory than exist. */
  const loadMore = useCallback(() => {
    if (loadingMore.current) return;
    try {
      if (events.length >= countEvents()) return;
      loadingMore.current = true;
      const next = listEventsPage(PAGE_SIZE, events.length);
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...next.filter((e) => !seen.has(e.id))];
      });
    } catch {
      // Pagination failure is non-fatal: the rows already loaded stay put.
    } finally {
      loadingMore.current = false;
    }
  }, [events]);

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

  const dismissLookBack = useCallback(() => {
    try {
      kvSet(`lookback.dismissed.${lookBackWeekKey(new Date())}`, '1');
    } catch {
      // Dismissal still hides the card for this session.
    }
    setLookBack(null);
  }, []);

  const sections = useMemo(
    () => buildSections(events.filter((e) => matchesFilter(e, filter)), dueDate),
    [events, filter, dueDate],
  );

  /**
   * Pages in events until `event` is in memory, then jumps the timeline
   * to its week band. The scroll is best-effort: rows have variable
   * heights, so an unmeasured target just leaves the list in place.
   */
  const scrollToEvent = useCallback(
    (event: LocalEvent) => {
      let loaded = events;
      while (
        !loaded.some((e) => e.id === event.id) &&
        loaded.length < countEvents()
      ) {
        const next = listEventsPage(PAGE_SIZE, loaded.length);
        if (next.length === 0) break;
        loaded = [...loaded, ...next];
      }
      setEvents(loaded);
      const targetSections = buildSections(
        loaded.filter((e) => matchesFilter(e, filter)),
        dueDate,
      );
      const sectionIndex = targetSections.findIndex((s) =>
        s.data.some((e) => e.id === event.id),
      );
      if (sectionIndex < 0) return;
      const itemIndex = targetSections[sectionIndex]!.data.findIndex(
        (e) => e.id === event.id,
      );
      requestAnimationFrame(() => {
        try {
          sectionListRef.current?.scrollToLocation({
            sectionIndex,
            itemIndex: Math.max(0, itemIndex),
            animated: true,
          });
        } catch {
          // Best-effort; the event is loaded even if the jump misses.
        }
      });
    },
    [events, filter, dueDate],
  );

  /** Weeks 1..current for the picker, newest first. */
  const pickerWeeks: WeekPickerWeek[] = useMemo(() => {
    if (!week || !dueDate) return [];
    const list: WeekPickerWeek[] = [];
    for (let w = week.week; w >= 1; w -= 1) {
      const range = pregnancyWeekRange(w, dueDate);
      list.push({
        week: w,
        title: `Week ${w}`,
        subtitle: range ? formatWeekRange(range.startISO, range.endISO) : '',
      });
    }
    return list;
  }, [week, dueDate]);

  /** Week-picker jump: loads until the band exists, then scrolls to it. */
  const onPickWeek = useCallback(
    (picked: number) => {
      setPickerVisible(false);
      const targetKey = `preg-${picked}`;
      let loaded = events;
      let targetSections = buildSections(
        loaded.filter((e) => matchesFilter(e, filter)),
        dueDate,
      );
      let sectionIndex = targetSections.findIndex((s) => s.key === targetKey);
      while (sectionIndex < 0 && loaded.length < countEvents()) {
        const next = listEventsPage(PAGE_SIZE, loaded.length);
        if (next.length === 0) break;
        loaded = [...loaded, ...next];
        targetSections = buildSections(
          loaded.filter((e) => matchesFilter(e, filter)),
          dueDate,
        );
        sectionIndex = targetSections.findIndex((s) => s.key === targetKey);
      }
      setEvents(loaded);
      if (sectionIndex < 0) return;
      const at = sectionIndex;
      requestAnimationFrame(() => {
        try {
          sectionListRef.current?.scrollToLocation({
            sectionIndex: at,
            itemIndex: 0,
            animated: true,
          });
        } catch {
          // Best-effort jump; the band is loaded even if the scroll misses.
        }
      });
    },
    [events, filter, dueDate],
  );

  const listEmpty = useMemo(() => {
    if (events.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your story starts here</Text>
          <Text style={styles.emptyBody}>
            Save a moment below — a thought, a photo, how you're feeling. It takes seconds.
          </Text>
        </View>
      );
    }
    // A filter matched nothing: warm, never blank (per the mockup).
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing here yet</Text>
        <Text style={styles.emptyBody}>
          Your story grows one small moment at a time.
        </Text>
      </View>
    );
  }, [events]);

  return (
    <Screen scroll={false} testID="home-screen" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Your story</Text>
        {week && (
          <Pressable
            testID="week-jump-button"
            accessibilityRole="button"
            accessibilityLabel={`Jump to a week, currently week ${week.week}`}
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [styles.jump, pressed && styles.jumpPressed]}
          >
            <Text style={styles.jumpText}>Week {week.week} ▾</Text>
          </Pressable>
        )}
      </View>
      <TimelineFilters value={filter} onChange={setFilter} testID="timeline-filters" />
      <View style={styles.stream}>
        <TimelineList
          sections={sections}
          lookBack={filter === 'all' ? lookBack : null}
          onDismissLookBack={dismissLookBack}
          onRevisitLookBack={scrollToEvent}
          onEndReached={loadMore}
          refreshing={refreshing}
          onRefresh={onRefresh}
          listEmpty={listEmpty}
          sectionListRef={sectionListRef}
        />
      </View>
      <View style={styles.composerWrap}>
        <Composer onSaved={onSaved} onUnsaved={onUnsaved} />
      </View>
      <WeekPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        weeks={pickerWeeks}
        currentWeek={week?.week ?? null}
        onPick={onPickWeek}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fontDisplay,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '600',
    color: colors.ink,
  },
  jump: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpPressed: {
    opacity: 0.7,
  },
  jumpText: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  stream: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fontDisplay,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
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
