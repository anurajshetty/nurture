/**
 * Onboarding (Epic 1.1 + 1.2).
 *
 * Five gentle steps, faithful to design/01-onboarding.html:
 *   0. Welcome — what Nurture is, in three bullets.
 *   1. Due date — date picker, or last period with Naegele's rule shown
 *      back for confirmation. Kind validation; "I'll do this later" skips
 *      ahead without ever blocking entry.
 *   2. A couple of quick things — singleton/multiples + first/subsequent
 *      chips (drives week-content personalization), smart defaults set,
 *      plus an optional baby-name field (skippable, local-only).
 *   3. Notifications — plain-language pre-prompt, one system permission
 *      request, and per-type toggles wired to notification_prefs.
 *   4. Done — week pill + due date, or a quiet no-date variant.
 *
 * No check-in time is set here (end-of-day nudge default 8:30 PM lives in
 * Settings). No celebration is forced, no fetal nicknames, no guilt copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  DatePickerField,
  Screen,
  Segmented,
  SettingsRow,
  Toggle,
} from '../src/components';
import { colors, radii, shadow, spacing, type as typeScale } from '../src/theme/tokens';
import { useOnboarding, type OnboardingDraft } from '../src/onboarding/useOnboarding';
import {
  addDaysISO,
  formatLong,
  naegele,
  parseISODate,
  toISODate,
  todayISO,
  validateDueDate,
  validateLmp,
  weekOf,
} from '../src/onboarding/dates';
import {
  getPrefs,
  requestNotificationPermissions,
  updatePrefs,
  type Prefs,
} from '../src/notifications/prefs';
import type { Pregnancy } from '../src/lib/types';

const STEP_COUNT = 5;

/** Default due date lands on week 24, like the approved mockup. */
function defaultDueISO(): string {
  return addDaysISO(todayISO(), 112) ?? todayISO();
}

/** Default last period matches the default due date via Naegele. */
function defaultLmpISO(): string {
  return addDaysISO(todayISO(), -168) ?? todayISO();
}

function dateOrToday(iso: string): Date {
  return parseISODate(iso) ?? new Date();
}

const BULLETS: { bold: string; rest: string }[] = [
  { bold: 'Log a moment in 10 seconds', rest: ' — no long forms, ever.' },
  { bold: 'One beautiful timeline', rest: ' of your whole journey.' },
  { bold: 'Private by default.', rest: ' No ads, no data sale, your story stays yours.' },
];

export default function OnboardingScreen() {
  const { complete } = useOnboarding();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'due' | 'lmp'>('due');
  const [dueISO, setDueISO] = useState(defaultDueISO);
  const [lmpISO, setLmpISO] = useState(defaultLmpISO);
  const [pregnancyType, setPregnancyType] = useState<Pregnancy['pregnancyType']>('singleton');
  const [parity, setParity] = useState<Pregnancy['parity']>('first');
  const [skippedDate, setSkippedDate] = useState(false);
  const [babyName, setBabyName] = useState('');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [permNote, setPermNote] = useState<string | null>(null);

  useEffect(() => {
    getPrefs()
      .then(setPrefs)
      .catch(() => {});
  }, []);

  const activeISO = mode === 'due' ? dueISO : lmpISO;
  const problem = mode === 'due' ? validateDueDate(dueISO) : validateLmp(lmpISO);
  const estimatedDue = mode === 'lmp' ? naegele(lmpISO) : dueISO;
  const week = estimatedDue && !problem ? weekOf(estimatedDue) : null;

  const minDate = dateOrToday(mode === 'due' ? todayISO() : (addDaysISO(todayISO(), -310) ?? todayISO()));
  const maxDate = dateOrToday(mode === 'due' ? (addDaysISO(todayISO(), 294) ?? todayISO()) : todayISO());

  const handleDateChange = useCallback(
    (selected: Date) => {
      const iso = toISODate(selected);
      if (mode === 'due') setDueISO(iso);
      else setLmpISO(iso);
    },
    [mode],
  );

  const patchPrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      const prev = prefs;
      const next = { ...(prev ?? {}), ...patch } as Prefs;
      setPrefs(next);
      try {
        await updatePrefs(patch);
      } catch {
        setPrefs(prev);
      }
    },
    [prefs],
  );

  const ensurePermission = useCallback(async () => {
    try {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        setPermNote('Notifications are off in your system settings — turn them on there any time you’d like the nudges.');
      }
    } catch {
      // Permission request unavailable; her toggle choice is still recorded.
    }
  }, []);

  const handleToggle = useCallback(
    async (key: 'appointmentReminders' | 'endOfDayEnabled', value: boolean) => {
      if (value) void ensurePermission();
      await patchPrefs({ [key]: value } as Partial<Prefs>);
    },
    [ensurePermission, patchPrefs],
  );

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    const trimmedName = babyName.trim() || null;
    const draft: OnboardingDraft = skippedDate
      ? { dueDate: null, lmpDate: null, pregnancyType, parity, babyName: trimmedName }
      : {
          dueDate: estimatedDue,
          lmpDate: mode === 'lmp' ? lmpISO : null,
          pregnancyType,
          parity,
          babyName: trimmedName,
        };
    await complete(draft);
    setFinishing(false);
    router.replace('/(tabs)');
  }, [finishing, skippedDate, estimatedDue, lmpISO, mode, pregnancyType, parity, babyName, complete]);

  return (
    <Screen>
      <View style={styles.dots} accessibilityElementsHidden>
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
        ))}
      </View>

      {step === 0 && (
        <View style={styles.step}>
          <View style={styles.mark} accessibilityElementsHidden>
            <Text style={styles.markGlyph}>✿</Text>
          </View>
          <Text style={styles.h2} accessibilityRole="header">
            Welcome to Nurture
          </Text>
          <Text style={styles.lede}>Your pregnancy, remembered gently.</Text>
          <View style={styles.bullets}>
            {BULLETS.map((b) => (
              <View key={b.bold} style={styles.bullet}>
                <View style={styles.tick} accessibilityElementsHidden>
                  <Text style={styles.tickGlyph}>✓</Text>
                </View>
                <Text style={styles.bulletText}>
                  <Text style={styles.bulletBold}>{b.bold}</Text>
                  {b.rest}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.spacer} />
          <Button title="Get started" onPress={() => setStep(1)} testID="onboarding-get-started" />
        </View>
      )}

      {step === 1 && (
        <View style={styles.step}>
          <Text style={styles.h2} accessibilityRole="header">
            When are you{'\n'}due?
          </Text>
          <Text style={styles.lede}>This sets your week. You can change it later.</Text>

          <Text style={styles.fieldLabel}>I know my…</Text>
          <Segmented
            options={['due', 'lmp'] as const}
            value={mode}
            onChange={setMode}
            labels={{ due: 'Due date', lmp: 'Last period' }}
            accessibilityLabel="I know my due date or last period"
            testID="onboarding-mode-segment"
          />

          <Text style={styles.fieldLabel}>{mode === 'due' ? 'Due date' : 'First day of last period'}</Text>
          <Card style={styles.pickerCard}>
            <DatePickerField
              value={dateOrToday(activeISO)}
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={handleDateChange}
              accessibilityLabel={mode === 'due' ? 'Choose your due date' : 'Choose the first day of your last period'}
              testID="onboarding-date-picker"
            />
          </Card>

          {mode === 'lmp' && !problem && estimatedDue && (
            <View style={styles.calc} accessibilityRole="text">
              <Text style={styles.calcText}>
                Estimated due date: <Text style={styles.calcBold}>{formatLong(estimatedDue)}</Text>
                {'\n'}From your last period — take a look and confirm.
              </Text>
            </View>
          )}
          {mode === 'due' && week && (
            <Text style={styles.weekNote}>
              That’s week {week.week}, day {week.day} — your weekly reading will match.
            </Text>
          )}
          {problem && (
            <Text style={styles.problem} accessibilityRole="text">
              {problem.message}
            </Text>
          )}

          <View style={styles.spacer} />
          <Button
            title="Continue"
            onPress={() => setStep(2)}
            disabled={!!problem}
            testID="onboarding-date-continue"
          />
          <Button
            title="I'll do this later"
            variant="ghost"
            onPress={() => {
              setSkippedDate(true);
              setStep(3);
            }}
            style={styles.ghostButton}
            textStyle={styles.ghostText}
            testID="onboarding-date-skip"
          />
        </View>
      )}

      {step === 2 && (
        <View style={styles.step}>
          <Text style={styles.h2} accessibilityRole="header">
            A couple of{'\n'}quick things
          </Text>
          <Text style={styles.lede}>This tunes your weekly reading. Skip anything you’re unsure of.</Text>

          <Text style={styles.q}>How many are you expecting?</Text>
          <Text style={styles.qsub}>One question, two taps.</Text>
          <View style={styles.chips}>
            <Chip
              label="One baby"
              selected={pregnancyType === 'singleton'}
              onPress={() => setPregnancyType('singleton')}
              testID="onboarding-chip-singleton"
            />
            <Chip
              label="Twins or more"
              selected={pregnancyType === 'multiples'}
              onPress={() => setPregnancyType('multiples')}
              testID="onboarding-chip-multiples"
            />
          </View>

          <Text style={styles.q}>Is this your first?</Text>
          <View style={styles.chips}>
            <Chip
              label="First pregnancy"
              selected={parity === 'first'}
              onPress={() => setParity('first')}
              testID="onboarding-chip-first"
            />
            <Chip
              label="I’ve done this before"
              selected={parity === 'subsequent'}
              onPress={() => setParity('subsequent')}
              testID="onboarding-chip-subsequent"
            />
          </View>

          <Text style={styles.q}>Have you picked a name?</Text>
          <Text style={styles.qsub}>Optional — your weekly reading can use it. Skip if you’d rather wait.</Text>
          <TextInput
            value={babyName}
            onChangeText={setBabyName}
            placeholder="Baby’s name (optional)"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            maxLength={40}
            style={styles.nameInput}
            accessibilityLabel="Baby’s name (optional)"
            testID="onboarding-baby-name"
          />

          <View style={styles.spacer} />
          <Button title="Continue" onPress={() => setStep(3)} testID="onboarding-chips-continue" />
        </View>
      )}

      {step === 3 && (
        <View style={styles.step}>
          <Text style={styles.h2} accessibilityRole="header">
            A gentle{'\n'}heads-up
          </Text>
          <Text style={styles.lede}>
            Nurture can send soft reminders — a nudge before each appointment, and one quiet
            evening note, only on days you haven’t saved anything. You choose what reaches
            you, and you can change it anytime in the You tab.
          </Text>

          <View style={styles.rows}>
            <SettingsRow
              icon="◉"
              title="Appointment reminders"
              subtitle="A nudge before each visit, with your questions ready."
              trailing={
                <Toggle
                  value={prefs?.appointmentReminders ?? true}
                  onValueChange={(v) => void handleToggle('appointmentReminders', v)}
                  accessibilityLabel="Appointment reminders"
                  testID="onboarding-toggle-appointments"
                />
              }
            />
            <SettingsRow
              icon="☾"
              title="End-of-day nudge"
              subtitle="One gentle note around 8:30 PM — only on quiet days."
              trailing={
                <Toggle
                  value={prefs?.endOfDayEnabled ?? true}
                  onValueChange={(v) => void handleToggle('endOfDayEnabled', v)}
                  accessibilityLabel="End-of-day nudge"
                  testID="onboarding-toggle-nudge"
                />
              }
            />
          </View>
          {permNote && <Text style={styles.permNote}>{permNote}</Text>}

          <View style={styles.spacer} />
          <Button
            title="Enable notifications"
            onPress={async () => {
              await ensurePermission();
              setStep(4);
            }}
            testID="onboarding-enable-notifications"
          />
          <Button
            title="Not now"
            variant="ghost"
            onPress={() => setStep(4)}
            style={styles.ghostButton}
            textStyle={styles.ghostText}
            testID="onboarding-notifications-skip"
          />
        </View>
      )}

      {step === 4 && (
        <View style={styles.step}>
          <View style={styles.spacer} />
          <Card style={styles.doneCard}>
            <View style={[styles.mark, styles.doneMark]} accessibilityElementsHidden>
              <Text style={styles.markGlyph}>✓</Text>
            </View>
            <Text style={styles.doneTitle}>You’re all set</Text>
            {!skippedDate && estimatedDue && (
              <View style={styles.weekPill} accessibilityElementsHidden>
                <Text style={styles.weekPillText}>
                  {week ? `Week ${week.week} · ` : ''}Due {formatLong(estimatedDue)}
                </Text>
              </View>
            )}
            <Text style={styles.doneLede}>
              {skippedDate
                ? 'Your journal is ready. Set your due date anytime from the You tab to unlock your weekly reading.'
                : 'Your journal is ready. Logging your first moment takes about ten seconds.'}
            </Text>
          </Card>
          <View style={styles.spacer} />
          <Button
            title="Start my journal"
            onPress={() => void finish()}
            loading={finishing}
            disabled={finishing}
            testID="onboarding-finish"
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
  },
  dotOn: {
    width: 26,
    borderRadius: 5,
    backgroundColor: colors.coral,
  },
  step: {
    flex: 1,
    paddingTop: spacing.sm,
  },
  spacer: {
    flex: 1,
    minHeight: spacing.lg,
  },
  h2: {
    ...typeScale.display,
    fontSize: 30,
    lineHeight: 36,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  lede: {
    ...typeScale.body,
    color: colors.muted,
    lineHeight: 25,
    marginBottom: spacing.xl,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  markGlyph: {
    fontSize: 30,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bullets: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  bullet: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickGlyph: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.sageDeep,
  },
  bulletText: {
    ...typeScale.body,
    color: colors.ink,
    flex: 1,
    lineHeight: 24,
  },
  bulletBold: {
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  pickerCard: {
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  calc: {
    backgroundColor: colors.sageTint,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  calcText: {
    ...typeScale.body,
    fontSize: 15,
    color: colors.sageDeep,
    lineHeight: 23,
  },
  calcBold: {
    fontWeight: '700',
  },
  weekNote: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: spacing.md,
    lineHeight: 21,
  },
  problem: {
    ...typeScale.body,
    fontSize: 15,
    color: colors.coralDeep,
    fontWeight: '600',
    marginTop: spacing.md,
    lineHeight: 23,
  },
  ghostButton: {
    marginTop: spacing.sm,
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  ghostText: {
    color: colors.muted,
  },
  q: {
    ...typeScale.headline,
    color: colors.ink,
    marginTop: spacing.xl,
    marginBottom: 2,
  },
  qsub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  nameInput: {
    minHeight: 56,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  rows: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  permNote: {
    ...typeScale.subhead,
    color: colors.muted,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  doneCard: {
    borderRadius: radii.cardLarge,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadow.card,
  },
  doneMark: {
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  doneTitle: {
    fontFamily: 'Georgia',
    fontSize: 26,
    lineHeight: 32,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  weekPill: {
    backgroundColor: colors.blush,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  weekPillText: {
    ...typeScale.body,
    fontSize: 15,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  doneLede: {
    ...typeScale.body,
    fontSize: 14.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 23,
    marginTop: spacing.sm,
  },
});
