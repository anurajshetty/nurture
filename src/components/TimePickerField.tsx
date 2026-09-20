/**
 * TimePickerField — native implementation (iOS compact field / Android
 * dialog). Metro picks `TimePickerField.web.tsx` on web.
 *
 * Feeds a plain Date back through `onChange`; only the time-of-day is
 * significant (the caller merges it onto its own calendar date via
 * `combineDateTime`). Warm styling matches the date field.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { formatTime } from '../logs/appointmentInput';

export interface TimePickerFieldProps {
  /** Currently selected time (time-of-day is what matters). */
  value: Date;
  /** Called with the newly chosen time (never on dismiss). */
  onChange: (date: Date) => void;
  accessibilityLabel: string;
  testID?: string;
}

export function TimePickerField({
  value,
  onChange,
  accessibilityLabel,
  testID,
}: TimePickerFieldProps) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed') return;
    if (!selected) return;
    onChange(selected);
  };

  if (Platform.OS === 'ios') {
    // Compact renders as a small tappable field — the sheet stays compact.
    // The pill chrome (border, radius, background) comes from the PARENT
    // (AppointmentSheet's whenPill), which also wraps the date field — so
    // this wrapper draws NO border of its own. An inner border here
    // renders as a doubled, offset ring inside the parent's (iOS, Sept
    // 20, 2026).
    return (
      <View style={styles.iosWrap}>
        <DateTimePicker
          value={value}
          mode="time"
          display="compact"
          onChange={handleChange}
          accentColor={colors.coral}
          testID={testID}
        />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setShowAndroidPicker(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}>
        <Text style={styles.pillText}>{formatTime(value)}</Text>
      </Pressable>
      {showAndroidPicker ? (
        <DateTimePicker
          value={value}
          mode="time"
          display="default"
          onChange={handleChange}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  /**
   * iOS compact-picker container. Deliberately borderless: the caller
   * (AppointmentSheet's whenPill) draws the single pill border around
   * both the date and time fields. Just centers the native field.
   */
  iosWrap: {
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pill: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillText: {
    ...typeScale.headline,
    fontWeight: '700',
    color: colors.ink,
  },
});
