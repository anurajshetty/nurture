/**
 * TimelineList (Epic 3.1; day groups approved by Anuraj Sept 20, 2026).
 *
 * The virtualized keepsake stream: a SectionList of day-group sections
 * ("Today", "Yesterday", "Friday, Sep 18") with EventCard rows.
 * Virtualization keeps 9 months of daily logging smooth. The memory
 * look-back card (track 3) sits above everything as the list header;
 * per-card relative times ("Today · 9:12 AM") come from EventCard itself.
 */

import type { ReactElement, Ref } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';
import type { TimelineSection } from './timeline';
import type { LookBack } from './lookback';
import LookBackCard from './LookBackCard';
import EventCard from '../composer/EventCard';

interface TimelineListProps {
  sections: TimelineSection[];
  lookBack: LookBack | null;
  onDismissLookBack(): void;
  onRevisitLookBack(e: LocalEvent): void;
  /** When present, appointment EventCards become pressable and call it with the event id (opens the appointment editor). */
  onAppointmentPress?(eventId: string): void;
  /** When present, appointment EventCards show the mockup-18 delete × in the top-right corner. */
  onAppointmentDelete?(eventId: string): void;
  onEndReached(): void;
  refreshing: boolean;
  onRefresh(): void;
  listEmpty: ReactElement | null;
  sectionListRef?: Ref<SectionList<LocalEvent, TimelineSection>>;
}

/**
 * Day group header: small uppercase muted label, per the approved mockup.
 * Day groups are quiet navigation — coral stays reserved for kickers and
 * active elements, so the label reads in the feed's muted gray.
 *
 * Sticky-section-header rule (Sept 2026 overlap bug): the background must
 * cover the header's FULL footprint. Backgrounds don't cover margins, so
 * the spacing around the text is padding (never margins) — otherwise
 * cards scrolling underneath show through the transparent margin zones
 * when the header sticks.
 */
function DayGroupHeader({ section }: { section: TimelineSection }) {
  return (
    <View style={styles.daygroup} testID={`day-group-${section.key}`}>
      <Text style={styles.dayLabel}>{section.title}</Text>
    </View>
  );
}

export default function TimelineList({
  sections,
  lookBack,
  onDismissLookBack,
  onRevisitLookBack,
  onAppointmentPress,
  onAppointmentDelete,
  onEndReached,
  refreshing,
  onRefresh,
  listEmpty,
  sectionListRef,
}: TimelineListProps) {
  return (
    <SectionList<LocalEvent, TimelineSection>
      ref={sectionListRef}
      testID="timeline-list"
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EventCard
          event={item}
          onAppointmentPress={onAppointmentPress}
          onAppointmentDelete={onAppointmentDelete}
        />
      )}
      renderSectionHeader={({ section }) => <DayGroupHeader section={section} />}
      stickySectionHeadersEnabled
      ListHeaderComponent={
        lookBack ? (
          <LookBackCard
            lookback={lookBack}
            onDismiss={onDismissLookBack}
            onRevisit={onRevisitLookBack}
          />
        ) : null
      }
      ListEmptyComponent={listEmpty}
      contentContainerStyle={styles.list}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      onScrollToIndexFailed={() => {
        // Rows have variable heights (no getItemLayout); a missed
        // scroll-to-week just leaves the list where it is rather than
        // throwing into the console.
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.coral}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.lg,
    // Clears the floating + button (72px tall, 20px above the screen
    // bottom): the last cards never slide underneath it.
    paddingBottom: 112,
    flexGrow: 1,
  },
  daygroup: {
    // Sticky section header: the cream background must cover the header's
    // FULL footprint. Backgrounds don't cover margins, so the spacing
    // around the text is padding (never margins) — otherwise cards
    // scrolling underneath show through the transparent margin zones when
    // the header sticks (Sept 2026 overlap bug).
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
    backgroundColor: colors.bg,
    zIndex: 1,
  },
  /** Small uppercase muted label — day groups are quiet navigation. */
  dayLabel: {
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.muted,
  },
});
