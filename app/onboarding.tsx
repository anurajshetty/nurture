/**
 * Onboarding (Epic 1.1 + 1.2, revised Sept 2026).
 *
 * Six gentle steps:
 *   0. Welcome — what Willow is, in three bullets. (unchanged)
 *   1. A little about you — her full name (required; label "YOUR NAME",
 *      placeholder "Your name"), due date or last period (required) with
 *      Naegele's rule shown back for confirmation. The date pickers start
 *      EMPTY — no pre-filled value, no default; a date counts only when she
 *      picks it (mockup 31, Anuraj Sept 21 2026). The week-preview helper
 *      and Continue enable only after a valid date is picked; tapping
 *      Continue without one shows the inline error "Pick a date to
 *      continue" verbatim, which clears on pick. Her birthday is optional
 *      and never errors. A gentle hint near the button still says what is
 *      needed.
 *   2. Share the journey — her personal 6-char invite code through the
 *      server-backed partner system (mockup 33, Sept 2026). Code, Copy and
 *      Share…; Continue moves on. Graceful when the backend isn't ready.
 *   3. A couple of quick things — singleton/multiples + first/subsequent
 *      chips (drives week-content personalization), smart defaults set,
 *      plus an optional baby-name field (skippable, local-only). (unchanged)
 *   4. Notifications — plain-language pre-prompt, one system permission
 *      request, and per-type toggles wired to notification_prefs. (unchanged)
 *   5. Done — week pill + due date, or a quiet no-date variant. (unchanged)
 *
 * No check-in time is set here (end-of-day nudge default 8:30 PM lives in
 * Settings). No celebration is forced, no fetal nicknames, no guilt copy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
import RoleSplitScreen from '../src/partner/RoleSplitScreen';
import CodeEntryScreen from '../src/partner/CodeEntryScreen';
import ConnectedScreen from '../src/partner/ConnectedScreen';
import ShareCodeScreen from '../src/partner/ShareCodeScreen';
import {
  clearOnboardingRole,
  getOnboardingRole,
  isPartnerLinked,
  setOnboardingRole,
  setPartnerLinked,
  setPartnerOnboardingDone,
  type OnboardingRole,
} from '../src/partner/inviteCodes';
import { kvGet, kvSet } from '../src/lib/db';
import { colors, radii, shadow, spacing, type as typeScale } from '../src/theme/tokens';
import { useOnboarding, type OnboardingDraft } from '../src/onboarding/useOnboarding';
import {
  addDaysISO,
  formatLong,
  parseISODate,
  toISODate,
  todayISO,
  validateDob,
  validateDueDate,
  validateLmp,
  weekOf,
} from '../src/onboarding/dates';
import { nameDatesView } from '../src/onboarding/profile';
import {
  getPrefs,
  requestNotificationPermissions,
  updatePrefs,
  type Prefs,
} from '../src/notifications/prefs';
import type { Pregnancy } from '../src/lib/types';

const STEP_COUNT = 6;

/** Default due date lands on week 24, like the approved mockup. */
function defaultDueISO(): string {
  return addDaysISO(todayISO(), 112) ?? todayISO();
}

/** Default last period matches the default due date via Naegele. */
function defaultLmpISO(): string {
  return addDaysISO(todayISO(), -168) ?? todayISO();
}

/** Neutral starting point when she opts into the birthday picker: 30 years back. */
function defaultDobISO(): string {
  return addDaysISO(todayISO(), -30 * 365) ?? todayISO();
}

/** Birthday bounds: up to a century back, never in the future. */
function dobMinDate(): Date {
  return dateOrToday(addDaysISO(todayISO(), -100 * 365) ?? todayISO());
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
  const { complete, completed } = useOnboarding();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'due' | 'lmp'>('due');
  const [ownerName, setOwnerName] = useState('');
  // Mockup 31 (Anuraj, Sept 21 2026): the date pickers start EMPTY — no
  // pre-filled value, no default. null = she hasn't picked yet; a date
  // counts only when she actively chooses it.
  const [dueISO, setDueISO] = useState<string | null>(null);
  const [lmpISO, setLmpISO] = useState<string | null>(null);
  // True once she tapped Continue without a valid date — drives the
  // verbatim inline error, which clears the moment she picks.
  const [dateAttempted, setDateAttempted] = useState(false);
  // The collapsed "Tap to pick a date" card expands into the picker on tap.
  const [dateOpen, setDateOpen] = useState(false);
  const [dobISO, setDobISO] = useState<string | null>(null);
  const [dobOpen, setDobOpen] = useState(false);
  const [pregnancyType, setPregnancyType] = useState<Pregnancy['pregnancyType']>('singleton');
  const [parity, setParity] = useState<Pregnancy['parity']>('first');
  // The no-date Done variant below is kept as designed; Screen 1 now
  // requires a date, so this stays false — the setter is gone on purpose.
  const [skippedDate] = useState(false);
  const [babyName, setBabyName] = useState('');
  // Mockup 33 (Sept 2026): the welcome role split comes before step 0.
  // null = not chosen yet. Persisted so a relaunch doesn't re-ask.
  const [role, setRole] = useState<OnboardingRole | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  // Partner path stage: code entry, then the connected confirmation.
  // The connected screen doubles as the partner's resting state until the
  // partner view ships — Done persists completion (partner.onboarding_done)
  // and stays here. It never returns to the role split (no re-ask loop)
  // and never routes into the Week tab (that's the pregnant user's
  // experience).
  const [partnerStage, setPartnerStage] = useState<'code' | 'connected'>('code');
  // Quiet toast for the share-code surface.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    try {
      const kv = { get: kvGet, set: kvSet };
      const saved = getOnboardingRole(kv);
      if (saved) {
        setRole(saved);
        if (saved === 'partner' && isPartnerLinked(kv)) setPartnerStage('connected');
      } else if (completed) {
        // Already onboarded on an older build — she's the mom, skip the split.
        setRole('mom');
      }
    } catch {
      // She'll just pick below.
    }
    setRoleLoaded(true);
  }, [completed]);

  const chooseRole = useCallback((r: OnboardingRole) => {
    setRole(r);
    try {
      const kv = { get: kvGet, set: kvSet };
      setOnboardingRole(kv, r);
      setPartnerStage(r === 'partner' && isPartnerLinked(kv) ? 'connected' : 'code');
    } catch {
      setPartnerStage('code');
    }
  }, []);

  const handlePartnerVerified = useCallback(() => {
    try {
      setPartnerLinked({ get: kvGet, set: kvSet });
    } catch {
      // The confirmation shows regardless.
    }
    setPartnerStage('connected');
  }, []);

  /**
   * Done on the connected confirmation: persist partner completion and stay
   * on the connected screen — it is the partner's resting state until the
   * partner view ships. Never the role split (no re-ask loop) and never the
   * Week tab (that's the pregnant user's experience).
   */
  const handlePartnerDone = useCallback(() => {
    try {
      setPartnerOnboardingDone({ get: kvGet, set: kvSet });
    } catch {
      // The screen stays regardless.
    }
  }, []);

  /** Back out of code entry: forget the role so the split re-asks. */
  const handlePartnerBack = useCallback(() => {
    try {
      clearOnboardingRole({ get: kvGet, set: kvSet });
    } catch {
      // The split shows regardless.
    }
    setRole(null);
    setPartnerStage('code');
  }, []);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [permNote, setPermNote] = useState<string | null>(null);

  useEffect(() => {
    getPrefs()
      .then(setPrefs)
      .catch(() => {});
  }, []);

  const activeISO = mode === 'due' ? dueISO : lmpISO;
  // Mockup 31 gating lives in nameDatesView() (pure, unit-tested). `problem`
  // only describes a date she actually picked — the empty state is never a
  // "problem", it simply keeps the helper hidden and the action muted.
  const view = nameDatesView({ mode, dueISO, lmpISO, ownerName, dateAttempted });
  const problem =
    activeISO == null ? null : mode === 'due' ? validateDueDate(activeISO) : validateLmp(activeISO);
  const estimatedDue = view.estimatedDue;
  // The Done step's week pill (reachable only after a valid date).
  const week = estimatedDue && !problem ? weekOf(estimatedDue) : null;

  // Screen 1 gating: her name + a valid date are required. The hint near
  // the button says what is still needed — never an error shout.
  const nameOk = ownerName.trim().length > 0;
  const continueHint = !nameOk && problem
    ? 'Almost there. Your name and a date are all we need to continue.'
    : !nameOk
      ? 'Almost there. Just your name above and we can continue.'
      : problem
        ? 'Almost there. Pick a date above to continue.'
        : null;

  const dobProblem = dobISO ? validateDob(dobISO) : null;
  const dobValue = dobISO ? dateOrToday(dobISO) : null;

  const minDate = dateOrToday(mode === 'due' ? todayISO() : (addDaysISO(todayISO(), -310) ?? todayISO()));
  const maxDate = dateOrToday(mode === 'due' ? (addDaysISO(todayISO(), 294) ?? todayISO()) : todayISO());

  const handleDateChange = useCallback(
    (selected: Date) => {
      const iso = toISODate(selected);
      // Picking a date clears the inline error immediately.
      setDateAttempted(false);
      if (mode === 'due') setDueISO(iso);
      else setLmpISO(iso);
    },
    [mode],
  );

  // Continue stays tappable while muted (mockup 31): attempting without a
  // valid date surfaces the verbatim inline error instead of doing nothing.
  const handleContinue = useCallback(() => {
    const v = nameDatesView({ mode, dueISO, lmpISO, ownerName, dateAttempted: true });
    if (!v.dateValid) {
      setDateAttempted(true);
      return;
    }
    if (v.nameMissing) return; // the hint near the button already says what's needed
    setStep(2);
  }, [mode, dueISO, lmpISO, ownerName]);

  const handleDobChange = useCallback((selected: Date) => {
    setDobISO(toISODate(selected));
  }, []);

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
      ? { dueDate: null, lmpDate: null, ownerName: ownerName.trim() || null, dob: dobISO, pregnancyType, parity, babyName: trimmedName }
      : {
          dueDate: estimatedDue,
          lmpDate: mode === 'lmp' ? lmpISO : null,
          ownerName: ownerName.trim() || null,
          dob: dobISO,
          pregnancyType,
          parity,
          babyName: trimmedName,
        };
    await complete(draft);
    setFinishing(false);
    // Group paths ('/(tabs)') don't resolve in the static web export —
    // redirect to the Week tab leaf instead (Week job finding, Sept 2026).
    router.replace('/week');
  }, [finishing, skippedDate, estimatedDue, lmpISO, mode, pregnancyType, parity, babyName, ownerName, dobISO, complete]);

  // Mockup 33: the welcome role split gates the mom's step flow. The
  // partner path never touches the pregnancy steps.
  if (!roleLoaded) {
    return (
      <Screen>
        <View />
      </Screen>
    );
  }
  if (role === null) {
    return (
      <Screen>
        <RoleSplitScreen onSelect={chooseRole} />
      </Screen>
    );
  }
  if (role === 'partner') {
    return (
      <Screen>
        {partnerStage === 'code' ? (
          <CodeEntryScreen onBack={handlePartnerBack} onVerified={handlePartnerVerified} />
        ) : (
          <ConnectedScreen onDone={handlePartnerDone} />
        )}
      </Screen>
    );
  }

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
            Welcome to Willow
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
            A little{'\n'}about you
          </Text>
          <Text style={styles.lede}>Just the basics. This is what makes your weeks feel like yours.</Text>

          <Text style={styles.fieldLabel}>YOUR NAME</Text>
          <TextInput
            value={ownerName}
            onChangeText={setOwnerName}
            placeholder="Your name"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            maxLength={40}
            style={styles.nameInput}
            accessibilityLabel="Your name"
            testID="onboarding-owner-name"
          />

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
          {/* Mockup 31: the picker starts as a quiet "Tap to pick a date"
              card — no pre-filled value anywhere. Tapping expands the real
              picker; the display default below is only what the native
              picker widget shows, never a chosen value. */}
          {!activeISO && !dateOpen ? (
            <Pressable
              onPress={() => setDateOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={mode === 'due' ? 'Pick your due date' : 'Pick the first day of your last period'}
              style={styles.dateCard}
              testID="onboarding-date-card"
            >
              <Text style={styles.dateCardPlaceholder}>Tap to pick a date</Text>
            </Pressable>
          ) : (
            <Card style={[styles.pickerCard, view.dateError ? styles.pickerCardError : null]}>
              <DatePickerField
                value={dateOrToday(activeISO ?? (mode === 'due' ? defaultDueISO() : defaultLmpISO()))}
                minimumDate={minDate}
                maximumDate={maxDate}
                onChange={handleDateChange}
                accessibilityLabel={mode === 'due' ? 'Choose your due date' : 'Choose the first day of your last period'}
                testID="onboarding-date-picker"
              />
            </Card>
          )}
          {view.dateError && (
            <Text style={styles.dateError} accessibilityRole="text" testID="onboarding-date-error">
              {view.dateError}
            </Text>
          )}

          {mode === 'lmp' && !problem && estimatedDue && (
            <View style={styles.calc} accessibilityRole="text">
              <Text style={styles.calcText}>
                Estimated due date: <Text style={styles.calcBold}>{formatLong(estimatedDue)}</Text>
                {'\n'}From your last period — take a look and confirm.
              </Text>
            </View>
          )}
          {view.helper && (
            <Text style={styles.weekNote} testID="onboarding-week-helper">
              {view.helper}
            </Text>
          )}
          {problem && (
            <Text style={styles.problem} accessibilityRole="text">
              {problem.message}
            </Text>
          )}

          <Text style={styles.fieldLabel}>Your birthday</Text>
          <Text style={styles.qsub}>Optional. It helps make your weekly reading feel a little more personal.</Text>
          {dobOpen || dobISO ? (
            <View>
              <Card style={styles.pickerCard}>
                <DatePickerField
                  value={dobValue}
                  emptyDisplayDate={dateOrToday(defaultDobISO())}
                  minimumDate={dobMinDate()}
                  maximumDate={dateOrToday(todayISO())}
                  onChange={handleDobChange}
                  accessibilityLabel="Choose your birthday"
                  testID="onboarding-dob-picker"
                />
              </Card>
              {dobProblem && (
                <Text style={styles.problem} accessibilityRole="text">
                  {dobProblem.message}
                </Text>
              )}
              {dobISO ? (
                <Button
                  title="Remove birthday"
                  variant="ghost"
                  onPress={() => {
                    setDobISO(null);
                    setDobOpen(false);
                  }}
                  style={styles.ghostButton}
                  textStyle={styles.ghostText}
                  testID="onboarding-dob-clear"
                />
              ) : null}
            </View>
          ) : (
            <Button
              title="Add your birthday (optional)"
              variant="ghost"
              onPress={() => {
                setDobOpen(true);
              }}
              style={styles.ghostButton}
              textStyle={styles.ghostText}
              testID="onboarding-dob-add"
            />
          )}

          <View style={styles.spacer} />
          {continueHint && (
            <Text style={styles.hint} testID="onboarding-continue-hint">
              {continueHint}
            </Text>
          )}
          <Button
            title="Continue"
            onPress={handleContinue}
            style={view.actionMuted ? styles.mutedAction : null}
            testID="onboarding-profile-continue"
          />
        </View>
      )}

      {step === 2 && (
        <View style={styles.step}>
          <Text style={styles.h2} accessibilityRole="header">
            Share this{'\n'}journey with{'\n'}your partner?
          </Text>
          <Text style={styles.lede}>
            Your partner enters your invite code in Willow on their phone. They will only ever see what you choose to share.
          </Text>
          <View style={styles.shareCodeHost}>
            <ShareCodeScreen onToast={showToast} showListCard={false} />
          </View>
          <View style={styles.spacer} />
          <Button
            title="Continue"
            onPress={() => setStep(3)}
            testID="onboarding-share-continue"
          />
        </View>
      )}

      {step === 3 && (
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
          <Button title="Continue" onPress={() => setStep(4)} testID="onboarding-chips-continue" />
        </View>
      )}

      {step === 4 && (
        <View style={styles.step}>
          <Text style={styles.h2} accessibilityRole="header">
            A gentle{'\n'}heads-up
          </Text>
          <Text style={styles.lede}>
            Willow can send soft reminders — a nudge before each appointment, and one quiet
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
              setStep(5);
            }}
            testID="onboarding-enable-notifications"
          />
          <Button
            title="Not now"
            variant="ghost"
            onPress={() => setStep(5)}
            style={styles.ghostButton}
            textStyle={styles.ghostText}
            testID="onboarding-notifications-skip"
          />
        </View>
      )}

      {step === 5 && (
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
                  {week ? `Week ${week.week + 1} · ` : ''}Due {formatLong(estimatedDue)}
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

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none" accessibilityRole="alert">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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
  shareCodeHost: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    flex: 1,
  },
  toastWrap: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  toastText: {
    ...typeScale.body,
    color: '#fff',
    textAlign: 'center',
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
  // Mockup 31: the collapsed "Tap to pick a date" card — no pre-filled
  // value, 44pt+ target like every other tap surface.
  dateCard: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dateCardPlaceholder: {
    ...typeScale.headline,
    color: colors.muted,
  },
  // The verbatim mandatory-date error; the card gets a ring to match.
  dateError: {
    ...typeScale.body,
    fontSize: 15,
    color: colors.coralDeep,
    fontWeight: '600',
    marginTop: spacing.sm,
    lineHeight: 23,
  },
  pickerCardError: {
    borderColor: colors.coral,
    borderWidth: 2,
  },
  // Muted-but-tappable action (mockup 31): the look of disabled, but the
  // tap still fires so the inline error can appear.
  mutedAction: {
    opacity: 0.55,
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
  hint: {
    ...typeScale.subhead,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  detected: {
    ...typeScale.subhead,
    color: colors.sageDeep,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  linkCard: {
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  linkLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  linkUrl: {
    ...typeScale.body,
    color: colors.ink,
    lineHeight: 22,
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
