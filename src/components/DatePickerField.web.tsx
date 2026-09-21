/**
 * DatePickerField — web implementation. `@react-native-community/datetimepicker`
 * has no web support, so this renders a styled native `<input type="date">`
 * that feeds the same Date values into the caller's logic. Warm styling
 * matches the onboarding date card.
 */
import { createElement, type CSSProperties } from 'react';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { parseISODate, toISODate } from '../onboarding/dates';

/**
 * Props mirror `DatePickerField.tsx` (declared here instead of imported so
 * Metro never resolves this file to itself on web).
 */
export interface DatePickerFieldProps {
  /**
   * Currently selected date, or null when she hasn't picked one yet.
   * Null renders a genuinely empty `<input type="date">` — no pre-filled
   * value, no hidden default. Dismissing without picking leaves null.
   */
  value: Date | null;
  minimumDate: Date;
  maximumDate: Date;
  /** Called with the newly chosen date (never on dismiss). */
  onChange: (date: Date) => void;
  accessibilityLabel: string;
  testID?: string;
  /**
   * Accepted for prop parity with the native implementation; ignored on
   * web (the input is empty when `value` is null).
   */
  emptyDisplayDate?: Date;
  /** Accepted for prop parity with the native implementation; ignored on web. */
  emptyText?: string;
}

export function DatePickerField({
  value,
  minimumDate,
  maximumDate,
  onChange,
  accessibilityLabel,
  testID,
}: DatePickerFieldProps) {
  const iso = value ? toISODate(value) : '';

  return createElement('input', {
    type: 'date',
    value: iso,
    min: toISODate(minimumDate),
    max: toISODate(maximumDate),
    'aria-label': accessibilityLabel,
    'data-testid': testID,
    onChange: (e: { target: { value: string } }) => {
      const parsed = parseISODate(e.target.value);
      if (parsed) onChange(parsed);
    },
    style: {
      width: '100%',
      minHeight: 56,
      padding: `${spacing.md}px ${spacing.lg}px`,
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
