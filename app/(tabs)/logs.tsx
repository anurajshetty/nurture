/**
 * Logs — the keepsake timeline (Epic 3), now the Logs tab.
 *
 * "Your story" header with the week filter pill (Anuraj Sept 2026: the
 * pill is a FILTER, not a jump — a selected week shows only that week's
 * day groups + entries; "All weeks" shows everything). Below it, the
 * filter chip row (track 2), and the virtualized timeline (day groups:
 * "Today", "Yesterday", "Friday, Sep 18" — newest first) with the memory
 * look-back card (track 3) pinned above it. The composer stays pinned at
 * the bottom; entries appear optimistically and Undo removes one.
 * Look-back is computed on focus, dismissible, and never a push. The
 * end-of-day nudge is re-evaluated whenever the stream changes or the
 * screen regains focus.
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
import { countEvents, deleteEvent, getEvent, listEventsInRange, listEventsPage } from '../../src/sync/store';
import {
  REPORT_SUMMARY_FAILED_TOAST,
  REPORT_SUMMARY_NOT_RELATED_TOAST,
  purgeLegacyFailedReportEntries,
  subscribeReportSummaryOutcome,
} from '../../src/reportSummary/client';
import { refreshAppointmentReminders } from '../../src/notifications/appointments';
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
import DeleteCardDialog, {
  deleteToastStyles,
} from '../../src/timeline/DeleteCardDialog';
import { deleteCopyFor } from '../../src/timeline/deleteCopy';
import { seedShareDefaultFromServer } from '../../src/partner/shareStore';
import { useLovedBy } from '../../src/partner/useLovedBy';

import WeekFilterDropdown, {
  type WeekFilterValue,
} from '../../src/timeline/WeekFilterDropdown';
import {
  buildDaySections,
  currentPregnancyWeek,
  displayWeekLabel,
  formatWeekRange,
  pregnancyWeekForEvent,
  pregnancyWeekRange,
  storyDateOf,
} from '../../src/timeline/timeline';
import type { TimelineSection } from '../../src/timeline/timeline';
import { useTimezoneVersion } from '../../src/time/timezone';
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
    // The sheet persists questions straight to the store, but this
    // screen's event list still holds the pre-edit snapshot — refresh the
    // edited appointment so its "{n} questions to ask" line is current the
    // moment the sheet closes. (The sheet is a BottomSheet, not a route,
    // so the focus-effect reload below does NOT refire on close.)
    if (editorEventId) {
      try {
        const fresh = getEvent(editorEventId);
        if (fresh) {
          setEvents((prev) => prev.map((e) => (e.id === fresh.id ? fresh : e)));
        }
      } catch {
        // The list keeps its snapshot; the next focus reload heals it.
      }
    }
  }, [editorEventId]);
  /**
   * Mockup 18/30 — delete any feed card. deleteTarget is the event
   * awaiting confirmation; the shared DeleteCardDialog renders the
   * per-type copy (deleteCopyFor). Confirming soft-deletes the event
   * (tombstone + sync outbox), cancels its reminder when it's an
   * appointment, removes it from the feed, and shows a type-specific
   * toast — no undo.
   */
  const [deleteTarget, setDeleteTarget] = useState<LocalEvent | null>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const deleteToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Report-summary failure toast (Anuraj, Sept 2026): a genuine failure
   * or an off-topic verdict hard-deletes the interim "Summarizing your
   * report…" entry — no card, no retry — and this transient toast is the
   * only surface. Same visual language as the delete toast; the app's
   * established transient-toast duration (2400ms).
   */
  const [reportToast, setReportToast] = useState<string | null>(null);
  const reportToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // One-time convergence: entries persisted by the old failure model
    // ('failed' states, including the retired 'not_configured' setup
    // card) are hard-deleted — no persistent failed card, ever
    // (Anuraj, Sept 20, 2026).
    purgeLegacyFailedReportEntries();
    return subscribeReportSummaryOutcome((eventId, kind) => {
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      if (reportToastTimer.current) clearTimeout(reportToastTimer.current);
      setReportToast(
        kind === 'not_related' ? REPORT_SUMMARY_NOT_RELATED_TOAST : REPORT_SUMMARY_FAILED_TOAST,
      );
      reportToastTimer.current = setTimeout(() => {
        setReportToast(null);
        reportToastTimer.current = null;
      }, 2400);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (reportToastTimer.current) clearTimeout(reportToastTimer.current);
    };
  }, []);
  const openDeleteConfirm = useCallback(
    (event: LocalEvent) => {
      setDeleteTarget(events.find((e) => e.id === event.id) ?? event);
    },
    [events],
  );
  const closeDeleteConfirm = useCallback(() => {
    setDeleteTarget(null);
  }, []);
  const confirmDeleteCard = useCallback(() => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const copy = deleteCopyFor(deleteTarget);
    const isAppointment = deleteTarget.type === 'appointment';
    deleteEvent(id);
    // A deleted appointment must not fire its reminder — reconcile the
    // scheduled set against the surviving events.
    if (isAppointment) void refreshAppointmentReminders().catch(() => {});
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setDeleteTarget(null);
    if (deleteToastTimer.current) clearTimeout(deleteToastTimer.current);
    setDeleteToast(copy.toast);
    deleteToastTimer.current = setTimeout(() => {
      setDeleteToast(null);
      deleteToastTimer.current = null;
    }, 1800);
    void syncNow().catch(() => {});
  }, [deleteTarget, syncNow]);
  // Seed the global sharing default from the server on first run of a
  // second device (no-op when a local value already exists).
  useEffect(() => {
    void seedShareDefaultFromServer().catch(() => {});
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
   * the SAME single formula the filter matches on (pregnancyWeekForEvent
   * on the event's STORY date, via storyDateOf: every entry sits in the
   * week it was logged in) — equals it, so the filter and the feed can
   * never disagree. The feed itself groups by day (buildDaySections);
   * the week pill is a pure filter and no longer renders as a divider.
   */
  const applyFilters = useCallback(
    (list: LocalEvent[]) => {
      let out = list.filter((e) => matchesFilter(e, filter));
      if (dueDate && weekFilter !== 'all') {
        out = out.filter((e) => pregnancyWeekForEvent(dueDate, storyDateOf(e)) === weekFilter);
      }
      return out;
    },
    [filter, weekFilter, dueDate],
  );

  // tzVersion: a device timezone change (PST → EST) while the app is open
  // recomputes day-group boundaries automatically (Anuraj, Sept 2026).
  const tzVersion = useTimezoneVersion();
  const sections = useMemo(
    () => buildDaySections(applyFilters(events)),
    [applyFilters, events, tzVersion],
  );

  // Mockup 34 (owner side): "Loved by {partner name}" on cards her partner
  // loved. Refetches whenever the visible id set changes.
  const visibleIds = useMemo(
    () => sections.flatMap((s) => s.data.map((e) => e.id)),
    [sections],
  );
  const lovedBy = useLovedBy(visibleIds);

  /**
   * Pages in events until `event` is in memory, then jumps the timeline
   * to its day group. The scroll is best-effort: rows have variable
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
      const targetSections = buildDaySections(applyFilters(loaded));
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
    [events, applyFilters],
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
    <Screen
      scroll={false}
      testID="logs-screen"
      style={styles.root}
      // The FloatingComposer wraps its own card in the shared
      // KeyboardAvoid — Screen's wrapper stays off to avoid a double
      // shift when the log composer opens the keyboard.
      keyboardAvoid={false}
    >
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
            onCardDelete={openDeleteConfirm}
            lovedBy={lovedBy}
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
      <DeleteCardDialog
        copy={deleteTarget ? deleteCopyFor(deleteTarget) : null}
        onDismiss={closeDeleteConfirm}
        onConfirm={confirmDeleteCard}
      />
      {deleteToast !== null ? (
        <View style={deleteToastStyles.wrap} pointerEvents="none">
          <View style={deleteToastStyles.pill} testID="delete-card-toast">
            <Text style={deleteToastStyles.text}>{deleteToast}</Text>
          </View>
        </View>
      ) : null}
      {reportToast !== null ? (
        <View style={deleteToastStyles.wrap} pointerEvents="none">
          <View style={deleteToastStyles.pill} testID="report-summary-toast">
            <Text style={deleteToastStyles.text}>{reportToast}</Text>
          </View>
        </View>
      ) : null}
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
