/**
 * Appointment intake sheet (Logs-tab Add button, Anuraj-approved Sept 2026).
 *
 * Minimum input: three fields, one Save. "What's it for?" (optional —
 * untitled becomes "Appointment"), When (date + time pills, default today
 * 10:30 AM), "With whom / where" (optional). Saved appointments use the
 * same event contract as the Composer's "Save as appointment?" proposal, so
 * they land in the Plan tab's reminder flow and the Week appointment card.
 * After saving, the app navigates to the appointment's Plan detail so the
 * new appointment visibly lands where she expects it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import BottomSheet from '../components/BottomSheet';
import { DatePickerField } from '../components/DatePickerField';
import { TimePickerField } from '../components/TimePickerField';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { saveEvent } from '../sync/store';
import { refreshAppointmentReminders } from '../notifications/appointments';
import type { LocalEvent } from '../lib/types';
import { buildAppointmentInput } from './appointmentInput';

// Matches the Composer's appointment proposal bounds: appointments are
// logged past or future, so the date picker spans a year either way.
const APPT_MIN_DATE = new Date();
APPT_MIN_DATE.setFullYear(APPT_MIN_DATE.getFullYear() - 1);
const APPT_MAX_DATE = new Date();
APPT_MAX_DATE.setFullYear(APPT_MAX_DATE.getFullYear() + 1);

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

  // The sheet stays mounted while hidden — start every session with a
  // fresh form, not the previous appointment's details.
  useEffect(() => {
    if (visible) {
      setWhat('');
      setDate(new Date());
      setTime(defaultTime());
      setWhere('');
    }
  }, [visible]);

  const save = useCallback(() => {
    const event = saveEvent(buildAppointmentInput({ what, date, time, where }));
    // The Plan tab owns appointment reminders; scheduling here too means a
    // reminder is set even if she never visits Plan. Safe to skip on failure.
    try {
      void refreshAppointmentReminders().catch(() => {});
    } catch {
      // Reminders stay as-is; the appointment itself is saved.
    }
    onSaved(event);
    // Land in Plan on the new appointment's detail — same deep link the
    // reminder flow uses, so the save visibly lands where she expects.
    router.push({ pathname: '/plan', params: { appointment: event.id } });
    onClose();
  }, [what, date, time, where, onSaved, onClose, router]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="New appointment"
      testID="appointment-sheet">
      <Text style={styles.title}>New appointment</Text>
      <Text style={styles.lede}>It will land in your Plan with your questions ready.</Text>

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
              minimumDate={APPT_MIN_DATE}
              maximumDate={APPT_MAX_DATE}
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
