import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getPrefs,
  requestNotificationPermissions,
  updatePrefs,
} from '../../src/notifications/prefs';
import { exportArchive, requestAccountDeletion } from '../../src/privacy/privacy';
import { getActivePregnancy } from '../../src/sync/store';
import { formatLong, weekOf } from '../../src/onboarding/dates';
import {
  BottomSheet,
  Button,
  Card,
  Screen,
  SectionHeader,
  SettingsRow,
  Toggle,
} from '../../src/components';
import { colors, radii, spacing, type as typeScale } from '../../src/theme/tokens';


const LEAD_OPTIONS = [
  { minutes: 15, label: '15 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
] as const;

const NUDGE_MIN = 17 * 60; // 5:00 PM
const NUDGE_MAX = 21 * 60; // 9:00 PM
const NUDGE_STEP = 30;

type Disposition = 'keep' | 'export' | 'delete';

const DISPOSITIONS: { id: Disposition; title: string; sub: string }[] = [
  {
    id: 'keep',
    title: 'Keep my data in the app',
    sub: 'Your timeline stays as memories. No new pregnancy content, no notifications.',
  },
  {
    id: 'export',
    title: 'Export first',
    sub: 'Download your story, then stop tracking.',
  },
  {
    id: 'delete',
    title: 'Delete everything',
    sub: 'Remove all pregnancy data from the app.',
  },
];

function formatClock(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

function formatHour(hhmm: string): string {
  const h = Number(hhmm.split(':')[0]);
  if (!Number.isFinite(h)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

function toClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Small − / value / + stepper used for lead time and nudge time. */
function TimeStepper({
  value,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  testID,
}: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  testID?: string;
}) {
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        onPress={onDecrease}
        accessibilityRole="button"
        accessibilityLabel={decreaseLabel}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepPressed]}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        onPress={onIncrease}
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepPressed]}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * You — the control room: notification pause + reminders, deep links to
 * partner / export / privacy / pregnancy settings, and the quiet
 * stop-tracking row. Built from design/06-reminders.html.
 */
export default function YouScreen() {
  const [endOfDayEnabled, setEndOfDayEnabled] = useState(true);
  const [endOfDayTime, setEndOfDayTime] = useState('20:30');
  const [appointmentReminders, setAppointmentReminders] = useState(true);
  const [leadMinutes, setLeadMinutes] = useState(60);
  const [globalPauseUntil, setGlobalPauseUntil] = useState<string | null>(null);
  const [quietHours, setQuietHours] = useState({ start: '21:00', end: '08:00' });

  const [stopOpen, setStopOpen] = useState(false);
  const [stopPhase, setStopPhase] = useState<'choose' | 'done'>('choose');
  const [disposition, setDisposition] = useState<Disposition>('keep');
  const [stopping, setStopping] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paused = globalPauseUntil !== null;

  // Real pregnancy line from onboarding (replaces the mockup's sample copy).
  const [pregnancyLine, setPregnancyLine] = useState('Your journal is just beginning');
  useEffect(() => {
    try {
      const p = getActivePregnancy();
      if (p?.dueDate) {
        const w = weekOf(p.dueDate);
        setPregnancyLine(
          w ? `Week ${w.week} · due ${formatLong(p.dueDate)}` : `Due ${formatLong(p.dueDate)}`,
        );
      } else if (p) {
        setPregnancyLine('Due date not set yet');
      }
    } catch {
      // Keep the gentle fallback.
    }
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Load saved preferences (owned by the data engineer).
  useEffect(() => {
    let alive = true;
    getPrefs()
      .then((p) => {
        if (!alive) return;
        setEndOfDayEnabled(p.endOfDayEnabled);
        setEndOfDayTime(p.endOfDayTime);
        setAppointmentReminders(p.appointmentReminders);
        setGlobalPauseUntil(p.globalPauseUntil);
        setQuietHours({ start: p.quietHoursStart, end: p.quietHoursEnd });
      })
      .catch(() => {
        // Prefs unavailable — the screen still works with gentle defaults.
      });
    return () => {
      alive = false;
    };
  }, []);

  const ensurePermission = useCallback(async () => {
    try {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        showToast('Heads up — notifications are off in your system settings, so reminders can’t reach you yet.');
      }
    } catch {
      // Permission request unavailable; the toggle still records her choice.
    }
  }, [showToast]);

  const handlePauseToggle = useCallback(async () => {
    const next = paused ? null : new Date().toISOString();
    setGlobalPauseUntil(next);
    try {
      await updatePrefs({ globalPauseUntil: next });
    } catch {
      showToast('That didn’t go through — nothing changed.');
      setGlobalPauseUntil(paused ? new Date().toISOString() : null);
      return;
    }
    showToast(paused ? 'Notifications resumed' : 'Notifications paused');
  }, [paused, showToast]);

  const handleAppointmentToggle = useCallback(
    async (value: boolean) => {
      setAppointmentReminders(value);
      if (value) void ensurePermission();
      try {
        await updatePrefs({ appointmentReminders: value });
      } catch {
        showToast('That didn’t go through — nothing changed.');
        setAppointmentReminders(!value);
      }
    },
    [ensurePermission, showToast],
  );

  const handleLeadStep = useCallback(
    (direction: 1 | -1) => {
      const idx = LEAD_OPTIONS.findIndex((o) => o.minutes === leadMinutes);
      const next =
        LEAD_OPTIONS[(idx + direction + LEAD_OPTIONS.length) % LEAD_OPTIONS.length].minutes;
      setLeadMinutes(next);
      updatePrefs({ appointmentLeadMinutes: next }).catch(() => {});
    },
    [leadMinutes],
  );

  const handleNudgeToggle = useCallback(
    async (value: boolean) => {
      setEndOfDayEnabled(value);
      if (value) void ensurePermission();
      try {
        await updatePrefs({ endOfDayEnabled: value });
      } catch {
        showToast('That didn’t go through — nothing changed.');
        setEndOfDayEnabled(!value);
      }
    },
    [ensurePermission, showToast],
  );

  const handleNudgeStep = useCallback(
    (delta: number) => {
      const next = Math.min(NUDGE_MAX, Math.max(NUDGE_MIN, clockToMinutes(endOfDayTime) + delta));
      const clock = toClock(next);
      setEndOfDayTime(clock);
      updatePrefs({ endOfDayTime: clock }).catch(() => {
        showToast('That didn’t go through — nothing changed.');
      });
    },
    [endOfDayTime, showToast],
  );

  const openStop = useCallback(() => {
    setStopPhase('choose');
    setDisposition('keep');
    setStopOpen(true);
  }, []);

  const confirmStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      if (disposition === 'export') {
        try {
          await exportArchive();
        } catch {
          // No archive writer is registered in this build (expo-file-system
          // isn't installed yet) — stay on the choose step and say so plainly.
          showToast('Export isn’t ready in this build yet — your data stays safe in the app.');
          return;
        }
      }
      if (disposition === 'delete') await requestAccountDeletion();
      const pauseStamp = new Date().toISOString();
      await updatePrefs({
        endOfDayEnabled: false,
        appointmentReminders: false,
        globalPauseUntil: pauseStamp,
      });
      setEndOfDayEnabled(false);
      setAppointmentReminders(false);
      setGlobalPauseUntil(pauseStamp);
      setStopPhase('done');
    } catch {
      showToast('Something didn’t go through — nothing changed. Take your time.');
    } finally {
      setStopping(false);
    }
  }, [disposition, stopping, showToast]);

  const leadLabel =
    LEAD_OPTIONS.find((o) => o.minutes === leadMinutes)?.label ?? '1 hour before';

  const doneTail =
    disposition === 'delete'
      ? 'Your data has been deleted.'
      : disposition === 'export'
        ? 'Your export is downloading. Your story is yours to keep.'
        : 'Your story stays as your memories — private, always.';

  return (
    <Screen scroll={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <Text style={styles.screenTitle} accessibilityRole="header">
        You
      </Text>

      <View style={styles.profile}>
        <View style={styles.avatar} accessibilityElementsHidden>
          <Text style={styles.avatarInitial}>M</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName}>Your account</Text>
          <Text style={styles.profileSub}>{pregnancyLine}</Text>
        </View>
      </View>

      <SectionHeader title="Notifications" />

      <Card style={[styles.pauseCard, paused && styles.pauseCardActive]}>
        <Text style={styles.pauseTitle}>{paused ? 'All quiet.' : 'Need a quiet stretch?'}</Text>
        <Text style={styles.pauseCopy}>
          {paused
            ? 'Notifications are paused. Come back whenever you’re ready — nothing is lost.'
            : 'Pause every notification until you return. Nothing is lost — your story waits.'}
        </Text>
        <Button
          title={paused ? 'Resume notifications' : 'Pause all notifications'}
          variant="ghost"
          onPress={handlePauseToggle}
          style={styles.pauseButton}
          testID="pause-all-button"
        />
      </Card>

      <View style={styles.rows}>
        <SettingsRow
          icon="◉"
          title="Appointment reminders"
          subtitle="A nudge before each visit, with your questions ready."
          trailing={
            <Toggle
              value={appointmentReminders}
              onValueChange={handleAppointmentToggle}
              accessibilityLabel="Appointment reminders"
              testID="appointment-reminders-toggle"
            />
          }
        />
        <SettingsRow
          icon="◍"
          title="Remind me"
          subtitle="How far ahead of each appointment."
          trailing={
            <TimeStepper
              value={leadLabel}
              onDecrease={() => handleLeadStep(-1)}
              onIncrease={() => handleLeadStep(1)}
              decreaseLabel="Less lead time"
              increaseLabel="More lead time"
              testID="lead-time-stepper"
            />
          }
        />
        <SettingsRow
          icon="☾"
          title="End-of-day nudge"
          subtitle={`One gentle nudge around ${formatClock(endOfDayTime)} — only on days you haven’t saved anything.`}
          trailing={
            <Toggle
              value={endOfDayEnabled}
              onValueChange={handleNudgeToggle}
              accessibilityLabel="End-of-day nudge"
              testID="end-of-day-toggle"
            />
          }
        />
        <SettingsRow
          icon="◐"
          title="Nudge time"
          subtitle="Set it once — we never asked during onboarding."
          trailing={
            <TimeStepper
              value={formatClock(endOfDayTime)}
              onDecrease={() => handleNudgeStep(-NUDGE_STEP)}
              onIncrease={() => handleNudgeStep(NUDGE_STEP)}
              decreaseLabel="Earlier nudge time"
              increaseLabel="Later nudge time"
              testID="nudge-time-stepper"
            />
          }
        />
      </View>

      <Text style={styles.note}>
        Quiet hours {formatHour(quietHours.start)} – {formatHour(quietHours.end)}, always.
        Lock-screen previews stay neutral — they never show symptoms, moods, or health details.
      </Text>

      <SectionHeader title="Your space" />

      <View style={styles.rows}>
        <SettingsRow
          icon="♥"
          title="Partner sharing"
          subtitle="No one connected yet"
          onPress={() => showToast('Partner sharing is coming soon — nothing is shared until then.')}
        />
        <SettingsRow
          icon="▤"
          tint={colors.blueTint}
          tintInk={colors.blue}
          title="Visit summary (PDF)"
          subtitle="For your appointments"
          onPress={() => showToast('Visit summaries are coming soon.')}
        />
        <SettingsRow
          icon="◈"
          tint={colors.sageTint}
          tintInk={colors.sageDeep}
          title="Privacy & data"
          subtitle="Export, deletion, app lock, what’s never tracked"
          onPress={() => showToast('Privacy controls are coming soon — your data stays on this device.')}
        />
        <SettingsRow
          icon="✦"
          tintInk={colors.gold}
          title="Pregnancy settings"
          subtitle="Due date, first or subsequent, appearance"
          onPress={() => showToast('Pregnancy settings are coming soon.')}
        />
      </View>

      <SectionHeader title="If things change" />

      <Pressable
        onPress={openStop}
        accessibilityRole="button"
        accessibilityLabel="Stop pregnancy tracking"
        style={({ pressed }) => [styles.quietRow, pressed && styles.quietPressed]}
      >
        <Text style={styles.quietLabel}>Stop pregnancy tracking</Text>
        <Text style={styles.quietChevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
      <Text style={styles.note}>
        Here quietly, whenever you need it. No questions asked, nothing rushed.
      </Text>

      <BottomSheet
        visible={stopOpen}
        onClose={() => setStopOpen(false)}
        accessibilityLabel="Stop pregnancy tracking"
        testID="stop-tracking-sheet"
      >
        {stopPhase === 'choose' ? (
          <View>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Stop pregnancy tracking?
            </Text>
            <Text style={styles.sheetLede}>
              Everything pregnancy-related will stop — updates, reminders, and partner
              notifications. Your data stays private.
            </Text>
            {DISPOSITIONS.map((d) => {
              const selected = disposition === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setDisposition(d.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={d.title}
                  accessibilityState={{ selected }}
                  style={[styles.disp, selected && styles.dispSelected]}
                >
                  <View
                    style={[styles.radio, selected && styles.radioSelected]}
                    accessibilityElementsHidden
                  >
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.dispText}>
                    <Text style={styles.dispTitle}>{d.title}</Text>
                    <Text style={styles.dispSub}>{d.sub}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Button
              title="Stop tracking"
              variant="ghost"
              onPress={confirmStop}
              loading={stopping}
              disabled={stopping}
              style={styles.stopButton}
              testID="confirm-stop-button"
            />
            <Pressable
              onPress={() => setStopOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Decide later"
              style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            >
              <Text style={styles.laterText}>Decide later</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.doneWrap}>
            <View style={styles.doneMedallion} accessibilityElementsHidden>
              <Text style={styles.doneCheck}>✓</Text>
            </View>
            <Text style={styles.sheetTitle}>Done — everything has stopped.</Text>
            <Text style={[styles.sheetLede, styles.doneLede]}>
              Updates, reminders, and partner notifications are off. {doneTail}
            </Text>
            <Button
              title="Close"
              variant="ghost"
              onPress={() => setStopOpen(false)}
              testID="stop-done-close"
            />
          </View>
        )}
      </BottomSheet>

      </ScrollView>

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  screenTitle: {
    ...typeScale.display,
    color: colors.ink,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: radii.chip,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'Georgia',
    fontSize: 24,
    color: colors.coralDeep,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    ...typeScale.headline,
    color: colors.ink,
  },
  profileSub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },

  pauseCard: {
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.sm,
  },
  pauseCardActive: {
    backgroundColor: colors.sageTint,
  },
  pauseTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  pauseCopy: {
    fontSize: 14.5,
    lineHeight: 22,
    color: '#5C554D',
  },
  pauseButton: {
    marginTop: spacing.md,
  },

  rows: {
    gap: spacing.sm,
  },
  note: {
    ...typeScale.subhead,
    color: colors.muted,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginHorizontal: spacing.xs,
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: radii.chip,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: {
    backgroundColor: colors.blush,
    borderColor: colors.coral,
  },
  stepGlyph: {
    fontSize: 20,
    color: colors.coralDeep,
    fontWeight: '600',
    lineHeight: 22,
  },
  stepValue: {
    ...typeScale.body,
    fontWeight: '700',
    color: colors.ink,
    minWidth: 96,
    textAlign: 'center',
  },

  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  quietPressed: {
    opacity: 0.7,
  },
  quietLabel: {
    ...typeScale.body,
    fontWeight: '600',
    color: colors.muted,
    flex: 1,
  },
  quietChevron: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
  },

  sheetTitle: {
    ...typeScale.title,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sheetLede: {
    ...typeScale.body,
    color: '#5C554D',
    marginBottom: spacing.lg,
  },
  disp: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 64,
  },
  dispSelected: {
    borderColor: colors.sageDeep,
    backgroundColor: colors.sageTint,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radii.chip,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioSelected: {
    borderColor: colors.sageDeep,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radii.chip,
    backgroundColor: colors.sageDeep,
  },
  dispText: {
    flex: 1,
    minWidth: 0,
  },
  dispTitle: {
    ...typeScale.body,
    fontWeight: '700',
    color: colors.ink,
  },
  dispSub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  stopButton: {
    marginTop: spacing.sm,
  },
  later: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  laterText: {
    ...typeScale.body,
    fontWeight: '600',
    color: colors.muted,
  },

  doneWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  doneMedallion: {
    width: 64,
    height: 64,
    borderRadius: radii.chip,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  doneCheck: {
    fontSize: 30,
    color: colors.sageDeep,
    fontWeight: '700',
  },
  doneLede: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  toast: {
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    maxWidth: 340,
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
