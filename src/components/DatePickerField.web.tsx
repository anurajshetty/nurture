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
  /** Currently selected date. */
  value: Date;
  minimumDate: Date;
  maximumDate: Date;
  /** Called with the newly chosen date (never on dismiss). */
  onChange: (date: Date) => void;
  accessibilityLabel: string;
  testID?: string;
}

export function DatePickerField({
  value,
  minimumDate,
  maximumDate,
  onChange,
  accessibilityLabel,
  testID,
}: DatePickerFieldProps) {
  const iso = toISODate(value);

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
