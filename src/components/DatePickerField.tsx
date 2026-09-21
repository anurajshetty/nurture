/**
 * DatePickerField — native implementation (iOS inline calendar / Android
 * dialog). Metro picks `DatePickerField.web.tsx` on web.
 *
 * Feeds a plain Date back through `onChange`; the caller owns formatting
 * and validation. Warm styling matches the onboarding date card.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { formatLong, toISODate } from '../onboarding/dates';

export interface DatePickerFieldProps {
  /**
   * Currently selected date, or null when she hasn't picked one yet.
   * Null never writes a default: the native spinner/dialog sits at
   * `emptyDisplayDate` purely as a display position, and web renders a
   * genuinely empty input. Dismissing without picking leaves null.
   */
  value: Date | null;
  minimumDate: Date;
  maximumDate: Date;
  /** Called with the newly chosen date (never on dismiss). */
  onChange: (date: Date) => void;
  accessibilityLabel: string;
  testID?: string;
  /**
   * Where the native spinner/dialog sits when `value` is null. Display
   * only — it is never reported through `onChange`. Defaults to today.
   * (Web ignores this and renders an empty input.)
   */
  emptyDisplayDate?: Date;
  /**
   * Android only: the field text when `value` is null.
   * Defaults to "Tap to pick a date".
   */
  emptyText?: string;
  /**
   * iOS only: render the compact tappable field instead of the inline
   * calendar (for tight sheets like the appointment intake). Android and
   * web are unchanged.
   */
  compact?: boolean;
}

export function DatePickerField({
  value,
  minimumDate,
  maximumDate,
  onChange,
  accessibilityLabel,
  testID,
  compact = false,
  emptyDisplayDate,
  emptyText,
}: DatePickerFieldProps) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  // Null = nothing chosen yet: the spinner/dialog needs a Date to sit at,
  // but that position is display-only and never flows back into state.
  const displayValue = value ?? emptyDisplayDate ?? new Date();

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed') return;
    if (!selected) return;
    onChange(selected);
  };

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={displayValue}
        mode="date"
        display={compact ? 'compact' : 'inline'}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        accentColor={colors.coral}
        onChange={handleChange}
        testID={testID}
      />
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setShowAndroidPicker(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={styles.androidField}
        testID={testID}
      >
        <Text style={[styles.androidFieldText, !value && styles.androidFieldEmpty]}>
          {value ? formatLong(toISODate(value)) : (emptyText ?? 'Tap to pick a date')}
        </Text>
        <Text style={styles.androidFieldChevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
      {showAndroidPicker && (
        <DateTimePicker
          value={displayValue}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  androidField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  androidFieldText: {
    ...typeScale.headline,
    color: colors.ink,
  },
  androidFieldEmpty: {
    color: colors.muted,
  },
  androidFieldChevron: {
    fontSize: 28,
    color: colors.muted,
    lineHeight: 32,
  },
});
