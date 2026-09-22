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
import DayGroupHeader from './DayGroupHeader';

interface TimelineListProps {
  sections: TimelineSection[];
  lookBack: LookBack | null;
  onDismissLookBack(): void;
  onRevisitLookBack(e: LocalEvent): void;
  /** When present, appointment EventCards become pressable and call it with the event id (opens the appointment editor). */
  onAppointmentPress?(eventId: string): void;
  /** When present, EVERY feed EventCard shows the mockup-18/30 delete × in the top-right corner. */
  onCardDelete?(event: LocalEvent): void;
  /** Loved-by partner names per event id (mockup 34, owner side). */
  lovedBy?: Record<string, string[]>;
  onEndReached(): void;
  refreshing: boolean;
  onRefresh(): void;
  listEmpty: ReactElement | null;
  sectionListRef?: Ref<SectionList<LocalEvent, TimelineSection>>;
}

export default function TimelineList({
  sections,
  lookBack,
  onDismissLookBack,
  onRevisitLookBack,
  onAppointmentPress,
  onCardDelete,
  lovedBy,
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
          onCardDelete={onCardDelete}
          lovedBy={lovedBy?.[item.id]}
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
});
