/**
 * Logs — the keepsake timeline (Epic 3), now the Logs tab.
 *
 * "Your story" header with the week filter pill (Anuraj Sept 2026: the
 * pill is a FILTER, not a jump — a selected week shows only that week's
 * divider + entries; "All weeks" shows everything). Below it, the filter
 * chip row (track 2), and the virtualized timeline (week bands, newest
 * first) with the memory look-back card (track 3) pinned above it. The
 * composer stays pinned at the bottom; entries appear optimistically and
 * Undo removes one. Look-back is computed on focus, dismissible, and
 * never a push. The end-of-day nudge is re-evaluated whenever the stream
 * changes or the screen regains focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import AddMenu from '../../src/logs/AddMenu';
import { refreshEndOfDayNudge } from '../../src/notifications/endOfDay';
import { useSync } from '../../src/sync/SyncContext';
import TimelineFilters, {
  matchesFilter,
  type FilterValue,
} from '../../src/timeline/TimelineFilters';
import TimelineList from '../../src/timeline/TimelineList';
import WeekFilterDropdown, {
  type WeekFilterValue,
} from '../../src/timeline/WeekFilterDropdown';
import {
  buildSections,
  currentPregnancyWeek,
  displayWeekLabel,
  formatWeekRange,
  pregnancyWeekForEvent,
  pregnancyWeekRange,
} from '../../src/timeline/timeline';
import type { TimelineSection } from '../../src/timeline/timeline';
import {
  chooseLookBack,
  lookBackWeekKey,
  lookBackWindow,
  type LookBack,
} from '../../src/timeline/lookback';
import AppointmentEditor from '../../src/logs/AppointmentEditor';

/** One timeline page; keeps 9 months of daily data smooth. */
const PAGE_SIZE = 60;

export default function LogsScreen() {
  const { pregnancy } = useOnboarding();
  const dueDate = pregnancy?.dueDate ?? null;
  const { syncNow } = useSync();

  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [lookBack, setLookBack] = useState<LookBack | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Week filter (Anuraj Sept 2026): the week pill is a FILTER, not a
   * jump. A selected week shows only that week's divider + entries;
   * 'all' shows everything. Defaults to the current week per the
   * approved mockup 13-logs-add. The selected week always matches the
   * visible feed — the pill, the filter, and the dividers all funnel
   * through the one shared formula in src/timeline/timeline.ts.
   * Internal values are completed-week numbers (1…42); every label she
   * sees shows the display week (completed + 1).
   */
  const [weekFilter, setWeekFilter] = useState<WeekFilterValue>(() => {
    const w = dueDate ? currentPregnancyWeek(dueDate) : null;
    return w ?? 'all';
  });
  /**
   * True once she picks a week filter herself (or a save resets it).
   * Until then the current-week default below applies — the screen can
   * mount before the due date is known, so the initializer alone isn't
   * enough.
   */
  const [weekFilterTouched, setWeekFilterTouched] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  /**
   * Appointment editor (Anuraj, Sept 2026): appointments live in the Logs
   * feed, and each appointment card opens the editor — via the card tap
   * (onAppointmentPress on the timeline rows) or the ?appointment=<id>
   * deep link. The editor itself (src/logs/AppointmentEditor) owns all
   * state; this screen only mounts it and hands it an event id.
   */
  const [editorEventId, setEditorEventId] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const openAppointment = useCallback((eventId: string) => {
    setEditorEventId(eventId);
    setEditorVisible(true);
  }, []);
  const closeAppointmentEditor = useCallback(() => {
    setEditorVisible(false);
  }, []);
  const { appointment: appointmentParam } =
    useLocalSearchParams<{ appointment?: string | string[] }>();
  useEffect(() => {
    if (typeof appointmentParam === 'string' && appointmentParam.length > 0) {
      openAppointment(appointmentParam);
    }
  }, [appointmentParam, openAppointment]);

  const sectionListRef = useRef<SectionList<LocalEvent, TimelineSection> | null>(null);
  const loadingMore = useRef(false);

  /** Completed-week number (1…42) — the internal value the filter matches on. All labels show the display week (completed + 1). */
  const currentWeek = dueDate ? currentPregnancyWeek(dueDate) : null;

  // Default to the current week once the due date is known, until she
  // picks a filter herself.
  useEffect(() => {
    if (!weekFilterTouched && currentWeek !== null) {
      setWeekFilter(currentWeek);
    }
  }, [weekFilterTouched, currentWeek]);

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
    // A new entry belongs to the current week, which may be filtered out;
    // return to the full story so she sees what she just saved.
    setWeekFilterTouched(true);
    setWeekFilter('all');
  }, []);

  const onFilterChange = useCallback((f: FilterValue) => {
    setFilter(f);
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

  /**
   * Both filters applied in one place: the type chip, then the week
   * filter. A selected week keeps only events whose week — computed by
   * the SAME single formula the dividers use (pregnancyWeekForEvent, via
   * pregnancyWeekForDay) — equals it, so the filter and the bands can
   * never disagree.
   */
  const applyFilters = useCallback(
    (list: LocalEvent[]) => {
      let out = list.filter((e) => matchesFilter(e, filter));
      if (dueDate && weekFilter !== 'all') {
        out = out.filter((e) => pregnancyWeekForEvent(dueDate, e.occurredAt) === weekFilter);
      }
      return out;
    },
    [filter, weekFilter, dueDate],
  );

  const sections = useMemo(
    () => buildSections(applyFilters(events), dueDate),
    [applyFilters, events, dueDate],
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
      // Look-back only renders when both filters are 'all', so this is
      // the same list the timeline shows; reuse the one filter path.
      const targetSections = buildSections(applyFilters(loaded), dueDate);
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
    [events, applyFilters, dueDate],
  );

  /** Week-filter select: apply the filter, close the dropdown. */
  const onSelectWeekFilter = useCallback((v: WeekFilterValue) => {
    setWeekFilterTouched(true);
    setWeekFilter(v);
    setFilterDropdownOpen(false);
  }, []);

  /** Clears the week filter and returns to the full story. */
  const backToAllWeeks = useCallback(() => {
    setWeekFilterTouched(true);
    setWeekFilter('all');
    setFilterDropdownOpen(false);
  }, []);

  const listEmpty = useMemo(() => {
    if (events.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your story starts here</Text>
          <Text style={styles.emptyBody}>
            Tap + below to save a moment — a thought, a photo, a report. It takes seconds.
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

  /** Empty state for a filtered week with no logged events. */
  const weekFilterEmpty = useMemo(() => {
    if (weekFilter === 'all' || !dueDate || sections.length > 0) return null;
    const range = pregnancyWeekRange(weekFilter, dueDate);
    return (
      <View style={styles.empty} testID="week-empty-state">
        <Text style={styles.emptyTitle}>Nothing logged for {displayWeekLabel(weekFilter)}</Text>
        <Text style={styles.emptyBody}>
          {range ? formatWeekRange(range.startISO, range.endISO) : ''}
          {'\n'}Your story grows one small moment at a time — save one below.
        </Text>
        <Pressable
          testID="week-empty-back"
          accessibilityRole="button"
          accessibilityLabel="Back to all weeks"
          onPress={backToAllWeeks}
          style={({ pressed }) => [styles.emptyBack, pressed && styles.jumpPressed]}
        >
          <Text style={styles.emptyBackText}>Back to all weeks</Text>
        </Pressable>
      </View>
    );
  }, [weekFilter, dueDate, sections, backToAllWeeks]);

  /**
   * Pill label: always the week the feed is showing ('All weeks' or the
   * DISPLAY week — completed + 1). The filter value itself stays on the
   * completed-week number so it matches the divider banding.
   */
  const weekFilterLabel = weekFilter === 'all' ? 'All weeks' : displayWeekLabel(weekFilter);

  return (
    <Screen scroll={false} testID="logs-screen" style={styles.root}>
      <View style={styles.header} testID="logs-header">
        <View style={styles.headerRow}>
          <Text style={styles.title}>Your story</Text>
          {currentWeek !== null && (
            <Pressable
              testID="week-jump-button"
              accessibilityRole="button"
              accessibilityLabel="Filter by week"
              accessibilityState={{ expanded: filterDropdownOpen }}
              onPress={() => setFilterDropdownOpen((o) => !o)}
              style={({ pressed }) => [styles.jump, pressed && styles.jumpPressed]}
            >
              <Text style={styles.jumpText}>{weekFilterLabel} ▾</Text>
            </Pressable>
          )}
        </View>
        <WeekFilterDropdown
          visible={filterDropdownOpen}
          currentWeek={currentWeek}
          value={weekFilter}
          onSelect={onSelectWeekFilter}
        />
      </View>
      <TimelineFilters value={filter} onChange={onFilterChange} testID="timeline-filters" />
      <View style={styles.stream}>
        {weekFilterEmpty ?? (
          <TimelineList
            sections={sections}
            lookBack={filter === 'all' && weekFilter === 'all' ? lookBack : null}
            onDismissLookBack={dismissLookBack}
            onRevisitLookBack={scrollToEvent}
            onAppointmentPress={openAppointment}
            onEndReached={loadMore}
            refreshing={refreshing}
            onRefresh={onRefresh}
            listEmpty={listEmpty}
            sectionListRef={sectionListRef}
          />
        )}
      </View>
      <AddMenu onSaved={onSaved} onUnsaved={onUnsaved} />
      <AppointmentEditor
        eventId={editorEventId}
        visible={editorVisible}
        onClose={closeAppointmentEditor}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    // Compact header (Anuraj Sept 2026): the title + week pill + filter
    // chips were eating ~40% of the viewport. Mockup 13-logs-add values —
    // 24px title, tight pill, ~90px header block total (through chips).
    paddingTop: 4,
    paddingBottom: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fontDisplay,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.ink,
  },
  jump: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 13,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpPressed: {
    opacity: 0.7,
  },
  jumpText: {
    fontSize: 13,
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
  emptyBack: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.card,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyBackText: {
    ...typeScale.body,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
});
