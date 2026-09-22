/**
 * Appointment intake sheet (Logs-tab Add button, Anuraj-approved Sept 2026).
 *
 * Minimum input: three fields, one Save. "What's it for?" (optional —
 * untitled becomes "Appointment"), When (date + time pills, default today
 * 10:30 AM), "With whom / where" (optional). Saved appointments use the
 * same event contract as the Composer's "Save as appointment?" proposal, so
 * they land in the Logs feed's reminder flow and the Week appointment card.
 * After saving, the app navigates to the appointment's Logs deep link
 * (/logs?appointment=<id>) so the new appointment visibly lands where
 * she expects it (the appointment editor opens there once the
 * Logs-side param handling lands).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import BottomSheet from '../components/BottomSheet';
import { DatePickerField } from '../components/DatePickerField';
import { TimePickerField } from '../components/TimePickerField';
import SharedSwitch from '../components/SharedSwitch';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { getActivePregnancy, saveEventAwaitingIdentity } from '../sync/store';
import { appointmentDateBounds } from '../onboarding/dates';
import { refreshAppointmentReminders } from '../notifications/appointments';
import type { LocalEvent } from '../lib/types';
import { buildAppointmentInput } from './appointmentInput';
import { HANDSHAKE_COPY, shareToggleLabels } from '../partner/sharing';
import { readShareDefaultSync } from '../partner/shareStore';

/** Default time when she doesn't touch the picker: 10:30 AM today. */
function defaultTime(): Date {
  const d = new Date();
  d.setHours(10, 30, 0, 0);
  return d;
}

export interface AppointmentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after the appointment is saved (timeline prepends it). */
  onSaved: (event: LocalEvent) => void;
}

export default function AppointmentSheet({ visible, onClose, onSaved }: AppointmentSheetProps) {
  const router = useRouter();
  const [what, setWhat] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(defaultTime);
  const [where, setWhere] = useState('');
  // Sharing switch starts at the global default (mockup
  // 33-entry-sharing device B: ON unless she changed it). Changing it
  // affects this appointment only — the global default is untouched.
  const [shared, setShared] = useState<boolean>(() => readShareDefaultSync());
  const shareLabels = shareToggleLabels(shared);

  // Picker window (Anuraj, Sept 2026): min = today (no past scheduled
  // dates); max = the pregnancy's due date + 2 months from the record, so
  // postpartum checkups after delivery stay pickable without the picker
  // running unbounded. The scheduled date is card data only — it never
  // affects feed position.
  const dateBounds = useMemo(() => {
    let due: string | null = null;
    try {
      due = getActivePregnancy()?.dueDate ?? null;
    } catch {
      // Store unavailable (tests) — appointmentDateBounds falls back to
      // today + 2 months.
    }
    return appointmentDateBounds(due);
  }, [visible]);

  // The sheet stays mounted while hidden — start every session with a
  // fresh form, not the previous appointment's details. The switch
  // re-reads the global default each time it opens.
  useEffect(() => {
    if (visible) {
      setWhat('');
      setDate(new Date());
      setTime(defaultTime());
      setWhere('');
      setShared(readShareDefaultSync());
    }
  }, [visible]);

  const save = useCallback(async () => {
    // Creation gate (sync bug fix, Sept 2026): await identity resolution
    // before stamping user_id — never queue a row that can never sync.
    const event = await saveEventAwaitingIdentity(
      buildAppointmentInput({ what, date, time, where }, shared ? 'shared' : 'private'),
    );
    // The tab shell refreshes appointment reminders on focus; scheduling
    // here too means a reminder is set even without that. Safe to skip
    // on failure.
    try {
      void refreshAppointmentReminders().catch(() => {});
    } catch {
      // Reminders stay as-is; the appointment itself is saved.
    }
    onSaved(event);
    // Land on the new appointment's Logs deep link — the same target the
    // reminder flow uses (/logs?appointment=<id>), so the save visibly
    // lands where she expects it.
    router.push({ pathname: '/logs', params: { appointment: event.id } });
    onClose();
  }, [what, date, time, where, shared, onSaved, onClose, router]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="New appointment"
      testID="appointment-sheet">
      <Text style={styles.title}>New appointment</Text>
      <Text style={styles.lede}>It will land in your Logs with your questions ready.</Text>

      <View style={styles.field}>
        <Text style={styles.label}>What’s it for?</Text>
        <TextInput
          style={styles.input}
          value={what}
          onChangeText={setWhat}
          placeholder="e.g. Growth scan"
          placeholderTextColor={colors.muted}
          returnKeyType="next"
          accessibilityLabel="What is the appointment for"
          testID="appointment-what"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>When</Text>
        <View style={styles.whenRow}>
          <View style={styles.whenPill} testID="appointment-date-wrap">
            <DatePickerField
              value={date}
              minimumDate={dateBounds.min}
              maximumDate={dateBounds.max}
              onChange={setDate}
              accessibilityLabel="Appointment date"
              testID="appointment-date"
              compact
            />
          </View>
          <View style={styles.whenPill} testID="appointment-time-wrap">
            <TimePickerField
              value={time}
              onChange={setTime}
              accessibilityLabel="Appointment time"
              testID="appointment-time"
            />
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>With whom / where</Text>
        <TextInput
          style={styles.input}
          value={where}
          onChangeText={setWhere}
          placeholder="e.g. Dr. Izu · Providence Holy Cross"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel="With whom or where"
          testID="appointment-where"
        />
      </View>

      {/* Per-appointment sharing (mockup 33-entry-sharing device B):
          real switch, starts at the global default. The handshake
          explainer sits above it, shown once. */}
      <View style={styles.explainerWrap} testID="appointment-share-explainer">
        <Text style={styles.explainerText}>{HANDSHAKE_COPY}</Text>
      </View>
      <View style={styles.shareRow} testID="appointment-share-row">
        <View style={styles.shareText}>
          <Text style={styles.shareLabel}>{shareLabels.status}</Text>
          <Text style={styles.shareHint}>{shareLabels.hint}</Text>
        </View>
        <SharedSwitch
          value={shared}
          onChange={setShared}
          accessibilityLabel="Share this appointment with your partner"
          testID="appointment-share-switch"
          compact
        />
      </View>

      <Pressable
        onPress={save}
        accessibilityRole="button"
        accessibilityLabel="Save appointment"
        testID="appointment-save"
        style={({ pressed }) => [styles.save, pressed && styles.savePressed]}>
        <Text style={styles.saveText}>Save appointment</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: 'Georgia',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.ink,
  },
  lede: {
    ...typeScale.footnote,
    color: colors.muted,
    lineHeight: 21,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: '#FFFEFB',
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 15.5,
    color: colors.ink,
    minHeight: 54,
  },
  whenRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  whenPill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: '#FFFEFB',
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  explainerWrap: {
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  explainerText: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    textAlign: 'center',
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  shareHint: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  shareText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  shareLabel: {
    ...typeScale.body,
    color: colors.ink,
    fontWeight: '700',
  },
  save: {
    backgroundColor: colors.coral,
    borderRadius: radii.card,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  savePressed: {
    backgroundColor: colors.coralDeep,
  },
  saveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
