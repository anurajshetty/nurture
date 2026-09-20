import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../src/components';
import JournalSheet from '../../src/logging/JournalSheet';
import { colors, eventDots, minTouch, radii, spacing, type as typeScale } from '../../src/theme/tokens';
import { getEvent } from '../../src/sync/store';
import { getPrefs } from '../../src/notifications/prefs';
import ReminderTimingSheet from '../../src/notifications/ReminderTimingSheet';
import {
  DEFAULT_REMINDER_MINUTES,
  appointmentLeadMinutes,
  formatLeadLabel,
  formatReminderSetToast,
} from '../../src/notifications/reminderTiming';
import {
  installReminderSurfaces,
  takeColdStartAppointmentResponse,
} from '../../src/notifications/snooze';
import { refreshAppointmentReminders, saveReminderLeadMinutes } from '../../src/notifications/appointments';
import { appointmentWhere, formatClock } from '../../src/notifications/reminderCopy';
import {
  appendQuestion,
  nextQuestionState,
  readQuestions,
  replaceQuestionState,
  saveQuestions,
  QUESTION_STATE_LABELS,
  type AppointmentQuestion,
  type QuestionState,
} from '../../src/plan/questions';
import type { LocalEvent, Prefs } from '../../src/lib/types';

/**
 * Plan (Epic 4): home for structured logging. The Journal tile opens the
 * journal sheet (Anuraj-approved round 6); further log types arrive with
 * their own approved sheets.
 *
 * Epic 6 addition: this screen is the deep-link target for appointment
 * reminders. When the route carries `?appointment=<eventId>` (tapped from
 * a notification, or a cold start from one), the appointment detail renders
 * instead of the tiles: when/where up top, the question inbox with tappable
 * state chips, and the reminder row that opens the timing editor sheet
 * (approved mockup 14). The Journal tile below is untouched.
 */

/** Reminder lead-time labels live in src/notifications/reminderTiming.ts. */

function formatHour(hhmm: string): string {
  const h = Number(hhmm.split(':')[0]);
  if (!Number.isFinite(h)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString([], { weekday: 'long' });
  const monthDay = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
}

/** Chip colors per question state (approved mockup 11, device ③). */
function chipStyle(state: QuestionState) {
  switch (state) {
    case 'to_ask':
      return { bg: colors.blush, fg: colors.coralDeep, strike: false, border: false };
    case 'asked':
      return { bg: colors.sageTint, fg: colors.sageDeep, strike: false, border: false };
    case 'answered':
      return { bg: colors.sageDeep, fg: '#FFFFFF', strike: false, border: false };
    case 'deferred':
      return { bg: '#EFE9DF', fg: colors.muted, strike: false, border: false };
    case 'dismissed':
      return { bg: '#FFFFFF', fg: '#CFC4B4', strike: true, border: true };
  }
}

function QuestionRow({
  question,
  onCycle,
}: {
  question: AppointmentQuestion;
  onCycle: () => void;
}) {
  const chip = chipStyle(question.state);
  return (
    <Pressable
      onPress={onCycle}
      accessibilityRole="button"
      accessibilityLabel={`${question.text} — ${QUESTION_STATE_LABELS[question.state]}. Tap to change.`}
      testID={`question-row-${question.id}`}
      style={({ pressed }) => [styles.qrow, pressed && styles.tilePressed]}
    >
      <Text style={styles.qtext}>{question.text}</Text>
      <View
        testID={`question-chip-${question.id}`}
        style={[
          styles.qchip,
          { backgroundColor: chip.bg },
          chip.border && styles.qchipBorder,
        ]}
      >
        <Text
          style={[
            styles.qchipText,
            { color: chip.fg },
            chip.strike && styles.qchipStrike,
          ]}
        >
          {QUESTION_STATE_LABELS[question.state]}
        </Text>
      </View>
    </Pressable>
  );
}

/** Appointment detail — the deep-link target for reminder taps (Epic 6 §6.1). */
function AppointmentDetail({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) {
  const [event, setEvent] = useState<LocalEvent | null>(() => {
    try {
      return getEvent(eventId);
    } catch {
      return null;
    }
  });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  /** Reminder timing editor sheet (approved mockup 14). */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const reload = useCallback(() => {
    try {
      setEvent(getEvent(eventId));
    } catch {
      setEvent(null);
    }
  }, [eventId]);

  /**
   * The timing editor's apply: persist the new lead time on THIS
   * appointment's event (its own `data.reminderLeadMinutes` — the global
   * default stays untouched), refresh the row, reschedule this device's
   * reminders, and confirm with a toast. The sheet settles away on its
   * own after the tap.
   */
  const handleApply = useCallback(
    (minutes: number) => {
      try {
        if (saveReminderLeadMinutes(eventId, minutes)) reload();
        showToast(formatReminderSetToast(minutes));
        void refreshAppointmentReminders();
      } catch {
        // Gentle fallback: the row keeps showing the last good value.
        showToast('That didn’t go through — nothing changed.');
        reload();
      }
    },
    [eventId, reload, showToast],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
      getPrefs()
        .then(setPrefs)
        .catch(() => setPrefs(null));
    }, [reload]),
  );

  const questions = event ? readQuestions(event) : [];

  const cycleQuestion = useCallback(
    (q: AppointmentQuestion) => {
      const updated = replaceQuestionState(questions, q.id, nextQuestionState(q.state));
      if (saveQuestions(eventId, updated)) reload();
    },
    [questions, eventId, reload],
  );

  const addQuestion = useCallback(() => {
    const updated = appendQuestion(questions, draft);
    if (updated.length === questions.length) return; // blank — nothing to save
    if (saveQuestions(eventId, updated)) {
      setDraft('');
      setAdding(false);
      reload();
    }
  }, [questions, draft, eventId, reload]);

  if (!event) {
    return (
      <View>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Plan"
          testID="appointment-back"
          style={styles.backRow}
        >
          <Text style={styles.backGlyph}>‹</Text>
          <Text style={styles.backText}>Plan</Text>
        </Pressable>
        <Text style={styles.heading}>This visit isn’t here anymore.</Text>
        <Text style={styles.missing}>It may have been deleted — your timeline keeps everything else safe.</Text>
      </View>
    );
  }

  const { provider, place } = appointmentWhere(event.data);
  const whereLine = [provider, place].filter(Boolean).join(', ');
  const sub = `${formatClock(event.occurredAt)}${whereLine ? ` · ${whereLine}` : ''}`;
  const quietNote = prefs
    ? `Quiet hours ${formatHour(prefs.quietHoursStart)} – ${formatHour(prefs.quietHoursEnd)}, always.`
    : 'Quiet hours 9 PM – 8 AM, always.';

  // Sheet context line ("Growth scan · Tue, Sep 22 · 10:30 AM") so she
  // always knows which visit the timing is for (approved mockup 14).
  const rawTitle = event.data?.title;
  const visitTitle =
    typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : 'Appointment';
  const visitDay = (() => {
    const d = new Date(event.occurredAt);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  })();
  const visitContext = `${visitTitle} · ${visitDay} · ${formatClock(event.occurredAt)}`;
  // Per-appointment timing: the event's own `data.reminderLeadMinutes`
  // wins; appointments that never set one fall back to the global
  // default (Prefs.appointmentLeadMinutes, 2 days).
  const leadMinutes = appointmentLeadMinutes(
    event.data,
    prefs?.appointmentLeadMinutes ?? DEFAULT_REMINDER_MINUTES,
  );
  const leadTitle = formatLeadLabel(leadMinutes);

  return (
    <View testID="appointment-detail">
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to Plan"
        testID="appointment-back"
        style={styles.backRow}
      >
        <Text style={styles.backGlyph}>‹</Text>
        <Text style={styles.backText}>Plan</Text>
      </Pressable>

      <View style={styles.landed} testID="appointment-landed">
        <Text style={styles.landedText}>🔔 You landed here from the reminder — everything for the visit is in one place.</Text>
      </View>

      <Text style={styles.apptHeading}>{formatDay(event.occurredAt)}</Text>
      <Text style={styles.apptSub}>{sub}</Text>

      <Text style={styles.kicker}>Your questions</Text>
      {questions.map((q) => (
        <QuestionRow key={q.id} question={q} onCycle={() => cycleQuestion(q)} />
      ))}
      {adding ? (
        <View style={styles.qaddBox} testID="question-add-box">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="What do you want to ask?"
            placeholderTextColor={colors.muted}
            style={styles.qinput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={addQuestion}
            testID="question-input"
            accessibilityLabel="New question"
          />
          <View style={styles.qaddActions}>
            <Pressable
              onPress={() => {
                setAdding(false);
                setDraft('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding question"
              testID="question-cancel"
              style={styles.qcancel}
            >
              <Text style={styles.qcancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={addQuestion}
              accessibilityRole="button"
              accessibilityLabel="Save question"
              testID="question-save"
              style={styles.qsave}
            >
              <Text style={styles.qsaveText}>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Add a question"
          testID="question-add"
          style={({ pressed }) => [styles.qadd, pressed && styles.tilePressed]}
        >
          <Text style={styles.qaddText}>＋ Add a question</Text>
        </Pressable>
      )}

      <Text style={styles.kicker}>Reminder</Text>
      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Reminder, ${leadTitle} — tap to change`}
        testID="appointment-reminder-row"
        style={({ pressed }) => [styles.setrow, pressed && styles.tilePressed]}
      >
        <View style={styles.setrowText}>
          <Text style={styles.setrowTitle}>{leadTitle}</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>
      <Text style={styles.note}>
        Running late? Your reminder can wait — snooze it straight from the notification. {quietNote}
      </Text>
      <ReminderTimingSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        leadMinutes={leadMinutes}
        visitContext={visitContext}
        quietNote={quietNote}
        onApply={handleApply}
      />
      {toast ? (
        <View style={styles.toast} testID="appointment-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function PlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointment?: string | string[] }>();
  const [journalOpen, setJournalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const white = '#FFFFFF';

  const rawParam = params.appointment;
  const paramId = Array.isArray(rawParam) ? rawParam[0] : rawParam;

  // Deep link: ?appointment=<eventId> (reminder tap / cold start) → detail.
  useEffect(() => {
    setSelectedId(typeof paramId === 'string' && paramId.length > 0 ? paramId : null);
  }, [paramId]);

  // Epic 6 reminder surfaces: action-button categories, tap → view/snooze/
  // pause/dismiss handling, and a scheduling refresh whenever Plan is visited.
  useEffect(() => {
    const cleanup = installReminderSurfaces({
      onViewAppointment: (id: string) =>
        router.push({ pathname: '/plan', params: { appointment: id } }),
    });
    void (async () => {
      const id = await takeColdStartAppointmentResponse();
      if (id) router.push({ pathname: '/plan', params: { appointment: id } });
    })();
    return cleanup;
    // Mount-only: the listener must survive re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAppointmentReminders();
    }, []),
  );

  const goBack = useCallback(() => {
    setSelectedId(null);
    router.setParams({ appointment: undefined });
  }, [router]);

  const closeJournal = useCallback(() => setJournalOpen(false), []);

  if (selectedId) {
    return (
      <Screen bottomPadding={120} testID="plan-screen">
        <AppointmentDetail eventId={selectedId} onBack={goBack} />
        <JournalSheet visible={journalOpen} onClose={closeJournal} />
      </Screen>
    );
  }

  return (
    <Screen bottomPadding={120} testID="plan-screen">
      <Text style={styles.heading}>Plan</Text>
      <Text style={styles.kicker}>Log something</Text>
      <Pressable
        onPress={() => setJournalOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Journal"
        testID="plan-tile-journal"
        style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      >
        <View style={[styles.icon, { backgroundColor: eventDots.note }]}>
          <Text style={[styles.iconGlyph, { color: white }]}>✎</Text>
        </View>
        <View style={styles.tileText}>
          <Text style={styles.tileTitle}>Journal</Text>
          <Text style={styles.tileSub}>A few lines, just for you</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>
      <JournalSheet visible={journalOpen} onClose={closeJournal} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typeScale.display,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    paddingLeft: 12,
    marginBottom: spacing.sm,
    minHeight: 72,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  tilePressed: {
    opacity: 0.96,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 22,
    fontWeight: '700',
  },
  tileText: {
    flex: 1,
  },
  tileTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  tileSub: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
    marginTop: 2,
  },
  chev: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
  },
  /* --- Epic 6: appointment detail --- */
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: minTouch,
    alignSelf: 'flex-start',
    paddingRight: spacing.lg,
    marginBottom: spacing.xs,
  },
  backGlyph: {
    fontSize: 26,
    fontWeight: '600',
    color: colors.coralDeep,
    marginTop: -2,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  landed: {
    backgroundColor: colors.sageTint,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    marginBottom: spacing.sm,
  },
  landedText: {
    fontSize: 13.5,
    color: colors.sageDeep,
    lineHeight: 20,
  },
  apptHeading: {
    ...typeScale.display,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  apptSub: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
    marginTop: 2,
  },
  missing: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  qrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    marginBottom: spacing.sm,
    minHeight: 60,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  qtext: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 20,
  },
  qchip: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  qchipBorder: {
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  qchipText: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  qchipStrike: {
    textDecorationLine: 'line-through',
  },
  qadd: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CFC4B4',
    borderRadius: 16,
    paddingVertical: 14,
    minHeight: 56,
    marginBottom: spacing.sm,
  },
  qaddText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  qaddBox: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  qinput: {
    fontSize: 15,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: spacing.sm,
    minHeight: minTouch,
  },
  qaddActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  qcancel: {
    minHeight: minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  qcancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
  qsave: {
    minHeight: minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.coral,
    borderRadius: 14,
  },
  qsaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  setrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
    marginBottom: spacing.sm,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  setrowText: {
    flex: 1,
  },
  setrowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  setrowSub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 3,
  },
  note: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  /* Confirmation toast after the timing editor applies ("Reminder set — …"). */
  toast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '92%',
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
