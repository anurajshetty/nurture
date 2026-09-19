/**
 * TimePickerField — web implementation. `@react-native-community/datetimepicker`
 * has no web support, so this renders a styled native `<input type="time">`
 * that feeds the same Date values into the caller's logic. Only the
 * time-of-day is significant; the calendar day comes from `value`.
 */
import { createElement, type CSSProperties } from 'react';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { parseTimeInputValue, toTimeInputValue } from '../logs/appointmentInput';

/**
 * Props mirror `TimePickerField.tsx` (declared here instead of imported so
 * Metro never resolves this file to itself on web).
 */
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
  return createElement('input', {
    type: 'time',
    value: toTimeInputValue(value),
    'aria-label': accessibilityLabel,
    'data-testid': testID,
    onChange: (e: { target: { value: string } }) => {
      const parsed = parseTimeInputValue(e.target.value, value);
      if (parsed) onChange(parsed);
    },
    style: {
      width: '100%',
      minHeight: 54,
      padding: `${spacing.sm}px ${spacing.lg}px`,
      fontSize: typeScale.headline.fontSize,
      fontWeight: typeScale.headline.fontWeight,
      color: colors.ink,
      backgroundColor: 'transparent',
      border: 'none',
      outline: 'none',
      cursor: 'pointer',
      accentColor: colors.coral,
    } as CSSProperties,
  });
}
