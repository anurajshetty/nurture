/**
 * Timeline filter chips (Epic 3.2): the filters row above the timeline.
 *
 * Pure filter logic (`FilterValue` + `matchesFilter`) lives alongside the
 * row component so Track 1 can import everything from this one module.
 * `matchesFilter` is deliberately pure — no database, no expo, no
 * react-native imports — so it is unit-testable in plain node.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import FilterChip, { type FilterKind } from '../components/FilterChip';
import { spacing } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';

/** The six filter buckets from the approved v1 timeline mockup. */
export type FilterValue =
  | 'all'
  | 'photos'
  | 'notes'
  | 'appointments'
  | 'symptoms'
  | 'kicks';

/**
 * True when `event`'s `data.attachments` contains a photo entry, parsed
 * defensively (same shape as the composer card: entries may be missing,
 * partial, or not objects at all).
 */
function hasPhotoAttachment(data: Record<string, unknown>): boolean {
  const raw = data.attachments;
  if (!Array.isArray(raw)) return false;
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    if ((a as Record<string, unknown>).kind === 'photo') return true;
  }
  return false;
}

/**
 * Filter predicate for the timeline stream. Pure: no db, no expo, no
 * react-native. Mapping (authoritative, per approved mockup):
 *
 * - 'all'         → every event (the store already excludes tombstones)
 * - 'photos'      → type 'photo', or any attachment with kind 'photo'
 * - 'notes'       → type 'note' or 'mood'
 * - 'appointments'→ type 'appointment'
 * - 'symptoms'    → type 'symptom'
 * - 'kicks'       → type 'kick_session' or 'milestone'
 *                     ("First strong kicks" is a milestone under Kicks)
 * - weight / question / file (and anything unknown) → 'all' only
 */
export function matchesFilter(event: LocalEvent, filter: FilterValue): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'photos':
      return event.type === 'photo' || hasPhotoAttachment(event.data);
    case 'notes':
      return event.type === 'note' || event.type === 'mood';
    case 'appointments':
      return event.type === 'appointment';
    case 'symptoms':
      return event.type === 'symptom';
    case 'kicks':
      return event.type === 'kick_session' || event.type === 'milestone';
    default:
      return false;
  }
}

type ChipDef = {
  value: FilterValue;
  kind: FilterKind;
  label: string;
};

/** Row order: "All" first so it is always one tap away. */
const CHIPS: ChipDef[] = [
  { value: 'all', kind: 'all', label: 'All' },
  { value: 'photos', kind: 'photo', label: 'Photos' },
  { value: 'notes', kind: 'note', label: 'Notes' },
  { value: 'appointments', kind: 'appointment', label: 'Appointments' },
  { value: 'symptoms', kind: 'symptom', label: 'Symptoms' },
  { value: 'kicks', kind: 'kick', label: 'Kicks' },
];

type TimelineFiltersProps = {
  value: FilterValue;
  onChange: (filter: FilterValue) => void;
  testID?: string;
};

/**
 * Horizontal, non-indicating scroll row of FilterChip pills (the approved
 * v1 chip family — same dot + glyph legend as the timeline cards below).
 * One chip family, one tap to "All".
 */
export default function TimelineFilters({ value, onChange, testID }: TimelineFiltersProps) {
  return (
    <View testID={testID ?? 'timeline-filters'}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
        accessibilityLabel="Filter timeline"
      >
        {CHIPS.map((chip) => (
          <FilterChip
            key={chip.value}
            kind={chip.kind}
            label={chip.label}
            selected={value === chip.value}
            onPress={() => onChange(chip.value)}
            testID={`filter-chip-${chip.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
