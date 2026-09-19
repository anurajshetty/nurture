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

/** The filter buckets (Anuraj Sept 2026: All · Reports · Appointments ·
 * Logs · Notes · Symptoms · Kicks — the Photos chip was dropped). */
export type FilterValue =
  | 'all'
  | 'reports'
  | 'appointments'
  | 'logs'
  | 'notes'
  | 'symptoms'
  | 'kicks';

/**
 * A health-document upload: ReportSheet always saves type 'report' (the entry
 * type is fixed by the + option that created it). Bare 'file' events and
 * events carrying `data.category = 'report'` are older uploads from before
 * the fixed typing — they still surface here.
 */
export function isReportEvent(event: LocalEvent): boolean {
  return event.type === 'report' || event.type === 'file' || event.data?.category === 'report';
}

/**
 * Filter predicate for the timeline stream. Pure: no db, no expo, no
 * react-native. Mapping (authoritative, Anuraj Sept 2026):
 *
 * - 'all'         → every event (the store already excludes tombstones)
 * - 'reports'     → health documents (Add report uploads)
 * - 'appointments'→ type 'appointment'
 * - 'logs'        → the journal core: everything she logged herself that
 *                   isn't a report, an appointment, or a bare file
 * - 'notes'       → type 'note' or 'mood'
 * - 'symptoms'    → type 'symptom'
 * - 'kicks'       → type 'kick_session' or 'milestone'
 *                     ("First strong kicks" is a milestone under Kicks)
 */
export function matchesFilter(event: LocalEvent, filter: FilterValue): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'reports':
      return isReportEvent(event);
    case 'appointments':
      return event.type === 'appointment';
    case 'logs':
      return (
        !isReportEvent(event) &&
        (event.type === 'note' ||
          event.type === 'mood' ||
          event.type === 'symptom' ||
          event.type === 'weight' ||
          event.type === 'photo' ||
          event.type === 'kick_session' ||
          event.type === 'milestone' ||
          event.type === 'question')
      );
    case 'notes':
      return event.type === 'note' || event.type === 'mood';
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

/** Row order (Anuraj Sept 2026): All · Reports · Appointments · Logs · Notes · Symptoms · Kicks. */
const CHIPS: ChipDef[] = [
  { value: 'all', kind: 'all', label: 'All' },
  { value: 'reports', kind: 'file', label: 'Reports' },
  { value: 'appointments', kind: 'appointment', label: 'Appointments' },
  { value: 'logs', kind: 'note', label: 'Logs' },
  { value: 'notes', kind: 'note', label: 'Notes' },
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
            compact
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
    // Tight filter row per the approved 13-logs-add mockup
    // (.filters{padding:2px 2px 6px}); horizontal stays aligned with the
    // 24px title above.
    paddingTop: 2,
    paddingBottom: 6,
  },
});
