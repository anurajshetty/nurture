/**
 * Reminder timing editor sheet (Anuraj-approved mockup 14, Sept 2026).
 *
 * Tapping the Reminder row on an appointment opens this sheet directly —
 * no more detour to You → Notifications. Five presets (1 hour / 3 hours /
 * 1 day / 2 days / 1 week before) apply with a single tap: the radio
 * fills, the parent persists + toasts, and the sheet settles away after
 * ~650ms. "Choose your own…" expands a stepper + typeable number (1–99)
 * with an Hours/Days toggle, a live preview, and a Set reminder button.
 *
 * The timing edited here is the appointment's OWN lead time (stored on the
 * event's `data.reminderLeadMinutes`); the global `Prefs.appointmentLeadMinutes`
 * stays the default for appointments that never set one. The sheet names
 * the visit in its context line so she always knows what the reminder
 * is for.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BottomSheet from '../components/BottomSheet';
import Segmented from '../components/Segmented';
import { colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';
import {
  CUSTOM_MIN,
  REMINDER_PRESETS,
  clampCustomN,
  customToMinutes,
  formatReminderPreview,
  minutesToCustom,
  type ReminderUnit,
} from './reminderTiming';

/** Preset taps settle away after the toast has had a moment to land. */
const PRESET_CLOSE_MS = 650;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** This appointment's currently stored lead minutes (its own value,
   * else the global default). */
  leadMinutes: number;
  /** "Growth scan · Tue, Sep 22 · 10:30 AM" — which visit this is for. */
  visitContext: string;
  /** Quiet-hours footnote, e.g. "Quiet hours 9 PM – 8 AM, always." */
  quietNote: string;
  /**
   * Persist the new lead time. The parent owns the appointment event: it
   * writes the value, refreshes its display, reschedules reminders, and
   * toasts "Reminder set — …". The sheet handles its own delayed close.
   */
  onApply: (minutes: number) => void;
};

export default function ReminderTimingSheet({
  visible,
  onClose,
  leadMinutes,
  visitContext,
  quietNote,
  onApply,
}: Props) {
  const [selected, setSelected] = useState<number | 'custom'>(() =>
    REMINDER_PRESETS.some((p) => p.minutes === leadMinutes) ? leadMinutes : 'custom',
  );
  const [customOpen, setCustomOpen] = useState(selected === 'custom');
  const [nText, setNText] = useState(() => String(minutesToCustom(leadMinutes).n));
  const [unit, setUnit] = useState<ReminderUnit>(() => minutesToCustom(leadMinutes).unit);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed from the stored value every time the sheet opens, so a
  // reopen always reflects the current timing.
  useEffect(() => {
    if (!visible) return;
    const isPreset = REMINDER_PRESETS.some((p) => p.minutes === leadMinutes);
    setSelected(isPreset ? leadMinutes : 'custom');
    setCustomOpen(!isPreset);
    const c = minutesToCustom(leadMinutes);
    setNText(String(c.n));
    setUnit(c.unit);
  }, [visible, leadMinutes]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, PRESET_CLOSE_MS);
  };

  const parsedN = (): number => {
    const n = parseInt(nText, 10);
    return clampCustomN(Number.isNaN(n) ? CUSTOM_MIN : n);
  };

  const step = (d: 1 | -1) => {
    const next = clampCustomN(parsedN() + d);
    setNText(String(next));
  };

  const pickPreset = (minutes: number) => {
    setSelected(minutes);
    setCustomOpen(false);
    onApply(minutes);
    closeSoon();
  };

  const openCustom = () => {
    setSelected('custom');
    setCustomOpen(true);
  };

  const setCustom = () => {
    onApply(customToMinutes(parsedN(), unit));
    closeSoon();
  };

  const preview = formatReminderPreview(parsedN(), unit);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Reminder timing"
      testID="reminder-sheet"
    >
      {/* The preset list + custom section can exceed the sheet's 86%
          max height on small screens — the approved mockup scrolls the
          sheet (overflow-y:auto). */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <Text style={styles.title}>Reminder</Text>
      <Text style={styles.context}>{visitContext}</Text>
      <Text style={styles.lede}>When should we nudge you?</Text>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Reminder timing presets"
      >
        {REMINDER_PRESETS.map((preset) => {
          const isSel = selected === preset.minutes;
          return (
            <Pressable
              key={preset.minutes}
              onPress={() => pickPreset(preset.minutes)}
              accessibilityRole="radio"
              accessibilityLabel={preset.label}
              accessibilityState={{ checked: isSel }}
              aria-checked={isSel}
              testID={`reminder-preset-${preset.minutes}`}
              style={({ pressed }) => [
                styles.opt,
                pressed && styles.optPressed,
              ]}
            >
              <View
                style={[styles.radio, isSel && styles.radioSel]}
                accessibilityElementsHidden
              >
                {isSel && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.optLabel}>{preset.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={openCustom}
          accessibilityRole="radio"
          accessibilityLabel="Choose your own reminder time"
          accessibilityState={{ checked: selected === 'custom' }}
          aria-checked={selected === 'custom'}
          testID="reminder-custom-option"
          style={({ pressed }) => [styles.opt, pressed && styles.optPressed]}
        >
          <View
            style={[styles.radio, selected === 'custom' && styles.radioSel]}
            accessibilityElementsHidden
          >
            {selected === 'custom' && <View style={styles.radioDot} />}
          </View>
          <Text style={styles.optLabel}>Choose your own…</Text>
        </Pressable>
      </View>

      {customOpen && (
        <View style={styles.custom} testID="reminder-custom-section">
          <View style={styles.stepRow}>
            <Pressable
              onPress={() => step(-1)}
              accessibilityRole="button"
              accessibilityLabel="Decrease reminder time"
              testID="reminder-step-down"
              style={({ pressed }) => [
                styles.stepBtn,
                pressed && styles.stepBtnPressed,
              ]}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </Pressable>
            <TextInput
              value={nText}
              onChangeText={(t) => setNText(t.replace(/[^0-9]/g, '').slice(0, 2))}
              onBlur={() => setNText(String(parsedN()))}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={2}
              selectTextOnFocus
              testID="reminder-custom-input"
              accessibilityLabel="Number of hours or days before the visit"
              style={styles.numInput}
            />
            <Pressable
              onPress={() => step(1)}
              accessibilityRole="button"
              accessibilityLabel="Increase reminder time"
              testID="reminder-step-up"
              style={({ pressed }) => [
                styles.stepBtn,
                pressed && styles.stepBtnPressed,
              ]}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </Pressable>
          </View>
          <Segmented
            options={['hour', 'day'] as const}
            value={unit}
            onChange={setUnit}
            labels={{ hour: 'Hours', day: 'Days' }}
            accessibilityLabel="Hours or days"
            testID="reminder-unit-toggle"
          />
          <Text style={styles.preview} testID="reminder-preview">
            {preview}
          </Text>
          <Pressable
            onPress={setCustom}
            accessibilityRole="button"
            accessibilityLabel={`Set reminder, ${preview.replace(/^We’ll remind you /, '').replace(/\.$/, '')}`}
            testID="reminder-set-custom"
            style={({ pressed }) => [
              styles.setBtn,
              pressed && styles.setBtnPressed,
            ]}
          >
            <Text style={styles.setBtnText}>Set reminder</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.fine}>{quietNote}</Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typeScale.title,
    color: colors.ink,
  },
  context: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  lede: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ink,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.card,
  },
  optPressed: {
    backgroundColor: colors.bg,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.toggleOff,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSel: {
    borderColor: colors.coral,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.coral,
  },
  optLabel: {
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.ink,
    flex: 1,
  },
  custom: {
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stepBtn: {
    width: minTouch,
    height: minTouch,
    borderRadius: minTouch / 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPressed: {
    backgroundColor: colors.card,
    opacity: 0.7,
  },
  stepGlyph: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.coralDeep,
    lineHeight: 24,
  },
  numInput: {
    flex: 1,
    height: 56,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.card,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.ink,
  },
  preview: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.sageDeep,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  setBtn: {
    backgroundColor: colors.coral,
    borderRadius: radii.button,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setBtnPressed: {
    backgroundColor: colors.coralDeep,
  },
  setBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  fine: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
