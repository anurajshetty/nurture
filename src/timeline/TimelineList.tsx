/**
 * TimelineList (Epic 3.1).
 *
 * The virtualized keepsake stream: a SectionList of week-band sections
 * with EventCard rows. Virtualization keeps 9 months of daily logging
 * smooth. The memory look-back card (track 3) sits above everything as
 * the list header; per-card relative times ("Today · 9:12 AM") come from
 * EventCard itself.
 */

import type { ReactElement, Ref } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fontDisplay, spacing, type as typeScale } from '../theme/tokens';
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
  onEndReached(): void;
  refreshing: boolean;
  onRefresh(): void;
  listEmpty: ReactElement | null;
  sectionListRef?: Ref<SectionList<LocalEvent, TimelineSection>>;
}

/** Week band header: serif title + muted range + hairline, per the mockup. */
function WeekBandHeader({ section }: { section: TimelineSection }) {
  return (
    <View style={styles.weekband} testID={`week-band-${section.key}`}>
      <Text style={styles.weekTitle}>{section.title}</Text>
      <Text style={styles.weekRange}>{section.subtitle}</Text>
      <View style={styles.hairline} />
    </View>
  );
}

export default function TimelineList({
  sections,
  lookBack,
  onDismissLookBack,
  onRevisitLookBack,
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
      renderItem={({ item }) => <EventCard event={item} />}
      renderSectionHeader={({ section }) => <WeekBandHeader section={section} />}
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
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  weekband: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.bg,
    paddingVertical: spacing.xs,
  },
  weekTitle: {
    fontFamily: fontDisplay,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.ink,
  },
  weekRange: {
    ...typeScale.footnote,
    color: colors.muted,
  },
  hairline: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
});
