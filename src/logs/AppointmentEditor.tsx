/**
 * Appointment questions sheet (Willow, mockup 17 — Anuraj approved Sept 19, 2026).
 *
 * The questions-only editor, opened at EVERY entry point: tapping an
 * appointment card in the Logs feed and the Week "Coming up" card open this
 * same sheet. The old full editor (mockup 15 dev3: visit heading, Notes,
 * per-appointment reminder timing) is RETIRED — appointment details are no
 * longer editable after creation; questions only.
 *
 * Spec (design/17-appointment-questions.html): date heading ("Saturday,
 * Sep 19"), "time · provider" sub, YOUR QUESTIONS kicker, plain question
 * rows with a × remove each, "+ Add a question" (disabled at 5 with
 * "That's 5 — the max. Remove one to add another."), empty state
 * "Jot down what you want to ask — up to 5.", coral Save below (no toast —
 * Anuraj, Sept 2026). No status pills, no Notes, no Reminder section.
 *
 * Questions persist immediately on add/remove (`data.questions` on the
 * event, via src/plan/questions.ts); Save just closes the sheet.
 *
 * Mounted by the Week tab (tap-through from the "Coming up" card) and the
 * Logs tab (card tap / ?appointment=<id> deep link). When the event is
 * gone, the sheet says so gently.
 */

import { useCallback, useEffect, useState } from 'react';
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
  spacing,
} from '../theme/tokens';
import { getEvent } from '../sync/store';
import { appointmentWhere, formatClock } from '../notifications/reminderCopy';
import {
  appendQuestion,
  readQuestions,
  saveQuestions,
} from '../plan/questions';
import { detachKick, readAttachedKicks } from '../kicks/appointments';
import { useTimezoneVersion } from '../time/timezone';
import { saveAttachedKicks } from '../kicks/store';
import { formatDurationShort, formatKickDate } from '../kicks/session';
import type { LocalEvent } from '../lib/types';

export interface AppointmentEditorProps {
  eventId: string | null;
  visible: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Small formatting helpers                                            */
/* ------------------------------------------------------------------ */

/** "Saturday, Sep 19" — the sheet heading (mockup 17). */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString([], { weekday: 'long' });
  const monthDay = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
}

/** Mockup 17 caps the list at five questions. */
const MAX_QUESTIONS = 5;

/* ------------------------------------------------------------------ */
/* The questions-only sheet                                            */
/* ------------------------------------------------------------------ */

export default function AppointmentEditor({
  eventId,
  visible,
  onClose,
}: AppointmentEditorProps) {
  // Timezone-change backstop (Anuraj, Sept 2026): the selected-date display
  // renders device-local — re-render when the zone changes mid-session.
  useTimezoneVersion();
  const [event, setEvent] = useState<LocalEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => {
    if (!eventId) {
      setEvent(null);
      return;
    }
    try {
      setEvent(getEvent(eventId));
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
    reload();
    // visible/eventId gate the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eventId]);

  const questions = event ? readQuestions(event) : [];
  const atMax = questions.length >= MAX_QUESTIONS;

  // Kick sessions attached from the Logs feed (mockup 25 — Anuraj approved
  // Sept 20, 2026). The whole KICKS section renders only when at least one
  // session is attached; with zero, the sheet is visually identical to
  // mockup 17. Max 5 per appointment, enforced at attach time.
  const kicks = event ? readAttachedKicks(event.data) : [];

  const removeKick = useCallback(
    (id: string) => {
      if (!eventId) return;
      const updated = detachKick(kicks, id);
      if (saveAttachedKicks(eventId, updated)) reload();
    },
    [kicks, eventId, reload],
  );

  const removeQuestion = useCallback(
    (id: string) => {
      if (!eventId) return;
      const updated = questions.filter((q) => q.id !== id);
      if (saveQuestions(eventId, updated)) reload();
    },
    [questions, eventId, reload],
  );

  const addQuestion = useCallback(() => {
    if (!eventId || atMax) return;
    const updated = appendQuestion(questions, draft);
    if (updated.length === questions.length) return; // blank — nothing to save
    if (saveQuestions(eventId, updated)) {
      setDraft('');
      setAdding(false);
      reload();
    }
  }, [questions, draft, eventId, atMax, reload]);

  // Questions persist immediately on add/remove; Save just closes.
  const handleSave = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Appointment questions"
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
                const { provider } = appointmentWhere(event.data);
                return provider
                  ? `${formatClock(event.occurredAt)} · ${provider}`
                  : formatClock(event.occurredAt);
              })()}
            </Text>

            <Text style={styles.kicker}>Your questions</Text>

            {questions.map((q) => (
              <View
                key={q.id}
                style={styles.qrow}
                testID={`question-row-${q.id}`}
              >
                <Text style={styles.qtext}>{q.text}</Text>
                <Pressable
                  onPress={() => removeQuestion(q.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove question: ${q.text}`}
                  testID={`question-remove-${q.id}`}
                  style={({ pressed }) => [
                    styles.qx,
                    pressed && styles.pressed,
                  ]}
                  hitSlop={8}
                >
                  <Text style={styles.qxText}>×</Text>
                </Pressable>
              </View>
            ))}

            {questions.length === 0 && !adding ? (
              <Text style={styles.empty} testID="question-empty">
                Jot down what you want to ask — up to 5.
              </Text>
            ) : null}

            {adding ? (
              <View style={styles.qaddBox} testID="question-add-box">
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Type your question…"
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
                    accessibilityLabel="Add question"
                    testID="question-add-confirm"
                    style={({ pressed }) => [
                      styles.qaddConfirm,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.qaddConfirmText}>Add</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setAdding(true)}
                disabled={atMax}
                accessibilityRole="button"
                accessibilityLabel="Add a question"
                testID="question-add"
                style={({ pressed }) => [
                  styles.qadd,
                  atMax && styles.qaddDisabled,
                  pressed && !atMax && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.qaddText, atMax && styles.qaddTextDisabled]}
                >
                  ＋ Add a question
                </Text>
              </Pressable>
            )}
            {atMax ? (
              <Text style={styles.maxnote} testID="question-max-note">
                That&apos;s 5 — the max. Remove one to add another.
              </Text>
            ) : null}

            {/* KICKS (mockup 25): only when sessions are attached. */}
            {kicks.length > 0 ? (
              <View testID="appointment-kicks">
                <Text style={styles.kicker}>Kicks</Text>
                {kicks.map((k) => (
                  <View
                    key={k.id}
                    style={styles.krow}
                    testID={`kick-row-${k.id}`}
                  >
                    <View style={styles.ktext}>
                      <Text style={styles.kdate}>
                        {formatKickDate(k.occurredAt)}
                      </Text>
                      <Text style={styles.kline}>
                        {k.movements} {k.movements === 1 ? 'kick' : 'kicks'} · in{' '}
                        {formatDurationShort(k.durationSec)}
                      </Text>
                      {k.strength ? (
                        <Text style={styles.kstrength}>{k.strength}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => removeKick(k.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Remove kick session"
                      testID={`kick-remove-${k.id}`}
                      style={({ pressed }) => [
                        styles.kx,
                        pressed && styles.pressed,
                      ]}
                      hitSlop={8}
                    >
                      <Text style={styles.kxText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Save questions"
              testID="appointment-save"
              style={({ pressed }) => [
                styles.save,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollBody: {
    paddingBottom: spacing.xl,
  },
  heading: {
    fontFamily: 'Georgia',
    fontSize: 34,
    fontWeight: '600',
    color: colors.ink,
  },
  sub: {
    fontSize: 19,
    color: colors.muted,
    marginTop: 6,
  },
  missing: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  kicker: {
    fontSize: 14,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: 26,
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.96,
  },
  qrow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingLeft: spacing.xl,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: spacing.sm,
    minHeight: 64,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  qtext: {
    flex: 1,
    fontSize: 17,
    color: colors.ink,
    lineHeight: 24,
  },
  qx: {
    width: minTouch,
    height: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  qxText: {
    fontSize: 22,
    color: colors.muted,
    lineHeight: 24,
  },
  empty: {
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 26,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 20,
    marginBottom: spacing.sm,
  },
  qadd: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D9CFC0',
    borderRadius: 20,
    minHeight: 64,
    marginBottom: spacing.sm,
  },
  qaddDisabled: {
    opacity: 0.35,
  },
  qaddText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  qaddTextDisabled: {
    color: colors.muted,
  },
  qaddBox: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 64,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  qinput: {
    fontSize: 17,
    color: colors.ink,
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
  qaddConfirm: {
    minHeight: minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  qaddConfirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  maxnote: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  /* KICKS section (mockup 25): attached kick sessions. Rendered only when
     at least one is attached. */
  krow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingLeft: spacing.xl,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: spacing.sm,
    minHeight: 64,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  ktext: {
    flex: 1,
  },
  kdate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  kline: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.ink,
  },
  kstrength: {
    fontSize: 13.5,
    fontStyle: 'italic',
    color: colors.muted,
  },
  kx: {
    width: minTouch,
    height: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  kxText: {
    fontSize: 19,
    color: '#B7ACA0',
    lineHeight: 24,
  },
  save: {
    backgroundColor: colors.coral,
    borderRadius: 18,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  saveText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
