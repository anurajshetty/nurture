/**
 * Appointment editor sheet (Willow, appointments-in-Logs-feed, Anuraj Sept 2026).
 *
 * The appointment detail ported from the deleted Plan page
 * (reference: AppointmentDetail in the old app/(tabs)/plan.tsx): visit
 * heading, prefilled "Your questions" list (add/cycle via
 * src/plan/questions.ts), the reminder row opening the approved
 * ReminderTimingSheet (per-appointment data.reminderLeadMinutes, 2-day
 * default), plus the NEW optional Notes field.
 *
 * NOTES CONTRACT: `event.data.notes` is the visit-notes field. It is
 * DISTINCT from the existing `event.data.note`, which is the
 * where/provider line written by the intake sheet and the Composer
 * proposal (src/logs/appointmentInput.ts) — never conflated.
 *
 * No back button: the sheet's close (scrim / swipe / ✕) dismisses.
 * Mounted by the Week tab (tap-through from the "Coming up" card) and,
 * once the Logs-side param handling lands, by the /logs?appointment=<id>
 * deep link. When the event is gone, the sheet says so gently.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BottomSheet from '../components/BottomSheet';
import {
  colors,
  minTouch,
  radii,
  spacing,
  type as typeScale,
} from '../theme/tokens';
import { getEvent } from '../sync/store';
import { getPrefs } from '../notifications/prefs';
import ReminderTimingSheet from '../notifications/ReminderTimingSheet';
import {
  DEFAULT_REMINDER_MINUTES,
  appointmentLeadMinutes,
  formatLeadLabel,
  formatReminderSetToast,
} from '../notifications/reminderTiming';
import {
  refreshAppointmentReminders,
  saveReminderLeadMinutes,
} from '../notifications/appointments';
import { appointmentWhere, formatClock } from '../notifications/reminderCopy';
import {
  appendQuestion,
  nextQuestionState,
  readQuestions,
  replaceQuestionState,
  saveQuestions,
  QUESTION_STATE_LABELS,
  type AppointmentQuestion,
  type QuestionState,
} from '../plan/questions';
import type { LocalEvent, Prefs } from '../lib/types';

export interface AppointmentEditorProps {
  eventId: string | null;
  visible: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Lazy native boundary (same pattern as src/plan/questions.ts)        */
/* ------------------------------------------------------------------ */

type AnyModule = Record<string, any>;

declare const require: (id: string) => unknown;

function lazyDb(): AnyModule {
  return require('../lib/db') as AnyModule;
}

/**
 * Persists the visit-notes field on one appointment event:
 * `data.notes` only — `data.note` (the where/provider line) is untouched.
 * Marks the row dirty and queues an upsert so the next sync carries it.
 * Returns false when the event doesn't exist. Never throws.
 */
export function saveAppointmentNotes(eventId: string, notes: string): boolean {
  try {
    const db = lazyDb();
    const row = db
      .getDb()
      .getFirstSync('SELECT data FROM events WHERE id = ?', eventId) as {
      data: string;
    } | null;
    if (!row) return false;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    const trimmed = notes.trim();
    if (trimmed.length > 0) {
      data.notes = trimmed;
    } else {
      delete data.notes;
    }
    const now = new Date().toISOString();
    db.getDb().withTransactionSync(() => {
      db
        .getDb()
        .runSync(
          'UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?',
          JSON.stringify(data),
          now,
          eventId,
        );
      db.getDb().runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
        `${Date.now().toString(36)}-${Math.floor(
          Math.random() * 1e9,
        ).toString(36)}`,
        eventId,
        now,
      );
    });
    return true;
  } catch {
    return false;
  }
}

/** Reads the visit-notes field (distinct from `data.note`). Pure. */
export function readAppointmentNotes(
  data: Record<string, unknown> | undefined,
): string {
  const raw = data?.notes;
  return typeof raw === 'string' ? raw : '';
}

/* ------------------------------------------------------------------ */
/* Small formatting helpers (ported from the Plan page)                */
/* ------------------------------------------------------------------ */

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
      style={({ pressed }) => [styles.qrow, pressed && styles.pressed]}
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

/* ------------------------------------------------------------------ */
/* The editor sheet                                                    */
/* ------------------------------------------------------------------ */

export default function AppointmentEditor({
  eventId,
  visible,
  onClose,
}: AppointmentEditorProps) {
  const [event, setEvent] = useState<LocalEvent | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  /** Visit notes (`data.notes`) — prefilled, saved with the Save button. */
  const [notes, setNotes] = useState('');
  const [notesInitial, setNotesInitial] = useState('');
  /** Reminder timing editor sheet (approved mockup 14). */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const reload = useCallback(() => {
    if (!eventId) {
      setEvent(null);
      return;
    }
    try {
      const fresh = getEvent(eventId);
      setEvent(fresh);
      if (fresh) setNotesInitial(readAppointmentNotes(fresh.data));
    } catch {
      setEvent(null);
    }
  }, [eventId]);

  // A sheet, not a screen: no useFocusEffect. Reload (and reset the
  // form state) every time the sheet opens for an id.
  useEffect(() => {
    if (!visible) return;
    setAdding(false);
    setDraft('');
    setSheetOpen(false);
    reload();
    try {
      const fresh = eventId ? getEvent(eventId) : null;
      setNotes(readAppointmentNotes(fresh?.data));
      setNotesInitial(readAppointmentNotes(fresh?.data));
    } catch {
      setNotes('');
      setNotesInitial('');
    }
    getPrefs()
      .then(setPrefs)
      .catch(() => setPrefs(null));
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // visible/eventId gate the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eventId]);

  const questions = event ? readQuestions(event) : [];

  const cycleQuestion = useCallback(
    (q: AppointmentQuestion) => {
      if (!eventId) return;
      const updated = replaceQuestionState(
        questions,
        q.id,
        nextQuestionState(q.state),
      );
      if (saveQuestions(eventId, updated)) reload();
    },
    [questions, eventId, reload],
  );

  const addQuestion = useCallback(() => {
    if (!eventId) return;
    const updated = appendQuestion(questions, draft);
    if (updated.length === questions.length) return; // blank — nothing to save
    if (saveQuestions(eventId, updated)) {
      setDraft('');
      setAdding(false);
      reload();
    }
  }, [questions, draft, eventId, reload]);

  const saveNotes = useCallback(() => {
    if (!eventId) return;
    if (saveAppointmentNotes(eventId, notes)) {
      setNotesInitial(notes.trim());
      showToast('Notes saved.');
      reload();
    } else {
      showToast('That didn’t go through — nothing changed.');
    }
  }, [eventId, notes, reload, showToast]);

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
        if (eventId && saveReminderLeadMinutes(eventId, minutes)) reload();
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

  const notesDirty = notes.trim() !== notesInitial.trim();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Appointment"
      testID="appointment-editor"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollBody}
      >
        {!event ? (
          <View testID="appointment-missing">
            <Text style={styles.heading}>This visit isn’t here anymore.</Text>
            <Text style={styles.missing}>
              It may have been deleted — your timeline keeps everything else
              safe.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.heading} testID="appointment-day">
              {formatDay(event.occurredAt)}
            </Text>
            <Text style={styles.sub} testID="appointment-sub">
              {(() => {
                const { provider, place } = appointmentWhere(event.data);
                const whereLine = [provider, place].filter(Boolean).join(', ');
                return `${formatClock(event.occurredAt)}${
                  whereLine ? ` · ${whereLine}` : ''
                }`;
              })()}
            </Text>

            <Text style={styles.kicker}>Your questions</Text>
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                onCycle={() => cycleQuestion(q)}
              />
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
                style={({ pressed }) => [styles.qadd, pressed && styles.pressed]}
              >
                <Text style={styles.qaddText}>＋ Add a question</Text>
              </Pressable>
            )}

            <Text style={styles.kicker}>Notes</Text>
            <View style={styles.notesBox}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything to remember for the visit — parking, questions you’d rather write than say…"
                placeholderTextColor={colors.muted}
                multiline
                style={styles.notesInput}
                testID="appointment-notes-input"
                accessibilityLabel="Notes for the visit"
              />
              <Pressable
                onPress={saveNotes}
                disabled={!notesDirty}
                accessibilityRole="button"
                accessibilityLabel="Save notes"
                testID="appointment-notes-save"
                style={({ pressed }) => [
                  styles.notesSave,
                  !notesDirty && styles.notesSaveDisabled,
                  pressed && notesDirty && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.notesSaveText,
                    !notesDirty && styles.notesSaveTextDisabled,
                  ]}
                >
                  Save notes
                </Text>
              </Pressable>
            </View>

            <Text style={styles.kicker}>Reminder</Text>
            <Pressable
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Reminder, ${leadLabelFor(event, prefs)} — tap to change`}
              testID="appointment-reminder-row"
              style={({ pressed }) => [styles.setrow, pressed && styles.pressed]}
            >
              <View style={styles.setrowText}>
                <Text style={styles.setrowTitle}>
                  {leadLabelFor(event, prefs)}
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
            <Text style={styles.note}>
              Running late? Your reminder can wait — snooze it straight from
              the notification.{' '}
              {prefs
                ? `Quiet hours ${formatHour(prefs.quietHoursStart)} – ${formatHour(
                    prefs.quietHoursEnd,
                  )}, always.`
                : 'Quiet hours 9 PM – 8 AM, always.'}
            </Text>
            <ReminderTimingSheet
              visible={sheetOpen}
              onClose={() => setSheetOpen(false)}
              leadMinutes={leadMinutesFor(event, prefs)}
              visitContext={visitContextFor(event)}
              quietNote={
                prefs
                  ? `Quiet hours ${formatHour(prefs.quietHoursStart)} – ${formatHour(
                      prefs.quietHoursEnd,
                    )}, always.`
                  : 'Quiet hours 9 PM – 8 AM, always.'
              }
              onApply={handleApply}
            />
          </View>
        )}
        {toast ? (
          <View style={styles.toast} testID="appointment-toast">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Timing helpers (ported from the Plan page)                          */
/* ------------------------------------------------------------------ */

/** Per-appointment lead minutes: own `data.reminderLeadMinutes` wins, else the global default (2 days). */
function leadMinutesFor(event: LocalEvent, prefs: Prefs | null): number {
  return appointmentLeadMinutes(
    event.data,
    prefs?.appointmentLeadMinutes ?? DEFAULT_REMINDER_MINUTES,
  );
}

function leadLabelFor(event: LocalEvent, prefs: Prefs | null): string {
  return formatLeadLabel(leadMinutesFor(event, prefs));
}

/** Sheet context line ("Growth scan · Tue, Sep 22 · 10:30 AM") so she always knows which visit the timing is for (approved mockup 14). */
function visitContextFor(event: LocalEvent): string {
  const rawTitle = event.data?.title;
  const visitTitle =
    typeof rawTitle === 'string' && rawTitle.trim()
      ? rawTitle.trim()
      : 'Appointment';
  const visitDay = (() => {
    const d = new Date(event.occurredAt);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
  })();
  return `${visitTitle} · ${visitDay} · ${formatClock(event.occurredAt)}`;
}

const styles = StyleSheet.create({
  scrollBody: {
    paddingBottom: spacing.xl,
  },
  heading: {
    ...typeScale.display,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 2,
  },
  sub: {
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
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.96,
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
  notesBox: {
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
  notesInput: {
    fontSize: 15,
    color: colors.ink,
    minHeight: 88,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  notesSave: {
    alignSelf: 'flex-end',
    minHeight: minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.coral,
    borderRadius: 14,
    marginTop: spacing.sm,
  },
  notesSaveDisabled: {
    backgroundColor: colors.line,
  },
  notesSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notesSaveTextDisabled: {
    color: colors.muted,
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
  chev: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
  },
  note: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  /* Confirmation toast ("Notes saved." / "Reminder set — …"). */
  toast: {
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '92%',
    marginTop: spacing.md,
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
