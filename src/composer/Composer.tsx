/**
 * The universal composer (Epic 2.1): the Muse-style heart of Willow.
 *
 * [+] attachment button · text field · one circular action (mic when
 * empty, send arrow when there's text). Text, voice, photo, and file
 * capture. Voice transcripts land in the field for review before sending.
 *
 * On-device intent detection only ever PROPOSES structured logs
 * ("Save as symptom?") — nothing is created without her explicit tap.
 *
 * The Smart Mood pill appears only when no mood was logged in the last
 * 4 hours. Saved entries land in the home stream optimistically with a
 * "Saved · Undo" toast. Everything works offline and queues for sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../components/BottomSheet';
import { DatePickerField } from '../components/DatePickerField';
import { toISODate } from '../onboarding/dates';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import { deleteEvent, saveEvent } from '../sync/store';
import {
  drainMediaOutbox,
  enqueueMediaUploads,
  purgeEventMedia,
} from '../sync/media';
import type { EventAttachment, EventInput, LocalEvent } from '../lib/types';
import { useSync } from '../sync/SyncContext';
import { refreshEndOfDayNudge } from '../notifications/endOfDay';
import { detectIntents, type IntentProposal } from './intent';
import { MOODS, setLastMoodAt, shouldShowMoodPill, type MoodId } from './moods';
import { startDictation } from './voice';
import {
  pickDocument,
  pickFromCamera,
  pickFromLibrary,
  revokeAttachmentUris,
  type PendingAttachment,
} from './attachments';

export interface ComposerProps {
  /** Prepends the saved event to the home stream (optimistic). */
  onSaved: (event: LocalEvent) => void;
  /** Removes the event from the home stream after Undo. */
  onUnsaved: (id: string) => void;
  /**
   * Floating "Log entry" mode (Logs-tab Add button): hide the
   * "How are you feeling?" mood pill. The pill logic stays intact — it
   * is only not rendered, so it can return later in one line.
   */
  hideMoodPill?: boolean;
  /**
   * Floating "Log entry" mode: the [+] sheet offers photos only
   * (Take a photo / Photo library) — files live in Add report.
   */
  photosOnly?: boolean;
  /**
   * Floating "Log entry" mode: vertically center the [+] and action
   * buttons in the bar instead of pinning them to the bottom edge.
   */
  centerActions?: boolean;
  /**
   * Floating "Log entry" mode: don't show the Composer's own "Saved —
   * Undo" toast after a send; the floating wrapper shows its own
   * "Saved to your story" toast instead.
   */
  suppressSaveToast?: boolean;
  /**
   * Called after a successful send (after `onSaved`). The floating
   * wrapper uses it to toast "Saved to your story" and settle away.
   */
  onSaveComplete?: (event: LocalEvent) => void;
}

interface Toast {
  message: string;
  undoId: string | null;
  key: number;
}

const TOAST_MS = 8000;
const MOOD_POPOVER_MS = 12000;

// "When?" row bounds on the appointment proposal (Epic 4.5): appointments
// are logged past or future, so the picker spans a year either way.
const APPT_MIN_DATE = new Date();
APPT_MIN_DATE.setFullYear(APPT_MIN_DATE.getFullYear() - 1);
const APPT_MAX_DATE = new Date();
APPT_MAX_DATE.setFullYear(APPT_MAX_DATE.getFullYear() + 1);

function formatElapsed(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function attachmentPayload(a: PendingAttachment): EventAttachment {
  return {
    id: a.id,
    kind: a.kind === 'video' ? 'file' : a.kind,
    name: a.name,
    mimeType: a.mimeType,
    local_uri: a.uri,
    upload: 'pending',
  };
}

export default function Composer({
  onSaved,
  onUnsaved,
  hideMoodPill = false,
  photosOnly = false,
  centerActions = false,
  suppressSaveToast = false,
  onSaveComplete,
}: ComposerProps) {
  const { syncNow } = useSync();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [listening, setListening] = useState(false);
  const [dictationSecs, setDictationSecs] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pillVisible, setPillVisible] = useState(() => shouldShowMoodPill());
  const [moodOpen, setMoodOpen] = useState(false);
  const [proposals, setProposals] = useState<IntentProposal[]>([]);
  const [proposalIdx, setProposalIdx] = useState(0);
  // Epic 4.5: the "When?" date on the appointment proposal. null means
  // untouched — buildEvent then defaults the event's occurredAt to today.
  const [appointmentDate, setAppointmentDate] = useState<Date | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const sessionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  // Monotonic id: callbacks from a superseded session (she started a new
  // one before the old one's final arrived) are ignored. User stop does
  // NOT bump this — the in-flight final of the session she just stopped
  // must still be applied.
  const sessionSeq = useRef(0);
  const listeningRef = useRef(false);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNoteRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const proposal = proposals[proposalIdx] ?? null;

  const clearToastTimer = () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
  };

  const showToast = useCallback((message: string, undoId: string | null) => {
    clearToastTimer();
    setToast({ message, undoId, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const stopElapsed = () => {
    if (elapsedTimer.current) {
      clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  };

  // Revoke web blob URLs for chips she removes or abandons — never the
  // URIs already saved into an event (the card renders them).
  useEffect(() => {
    return () => {
      clearToastTimer();
      if (moodTimer.current) clearTimeout(moodTimer.current);
      stopElapsed();
      sessionRef.current?.abort();
      revokeAttachmentUris(attachments);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A dictation session finished on its own terms (final/error). Stale
  // sessions — superseded by a newer one — must not touch the field.
  const finishVoice = useCallback((id: number, finalText?: string) => {
    if (id !== sessionSeq.current) return;
    sessionRef.current = null;
    stopElapsed();
    listeningRef.current = false;
    setListening(false);
    if (finalText !== undefined) setText(finalText);
  }, []);

  const stopListening = useCallback(() => {
    // User tapped stop: ask the OS for its final result, then let the
    // session's onFinal land it via finishVoice. The session id stays
    // valid so that in-flight final isn't treated as stale.
    sessionRef.current?.stop();
    sessionRef.current = null;
    stopElapsed();
    listeningRef.current = false;
    setListening(false);
  }, []);

  const startVoice = useCallback(async () => {
    if (listeningRef.current) return;
    const id = sessionSeq.current + 1;
    sessionSeq.current = id;
    listeningRef.current = true;
    setListening(true);
    setDictationSecs(0);
    stopElapsed();
    elapsedTimer.current = setInterval(() => {
      setDictationSecs((s) => s + 1);
    }, 1000);
    const session = await startDictation({
      onInterim: (t) => {
        if (id === sessionSeq.current) setText(t);
      },
      onFinal: (t) => finishVoice(id, t),
      onError: (message) => {
        const fresh = id === sessionSeq.current;
        finishVoice(id);
        if (fresh) showToast(message, null);
      },
      onLimitReached: (message) => showToast(message, null),
    });
    if (!session) {
      // Permission denied or unavailable — error toast already shown.
      finishVoice(id);
      return;
    }
    if (!listeningRef.current || id !== sessionSeq.current) {
      // She tapped stop (or the screen unmounted) while the permission
      // dialog was up, or a newer session already started — tear this
      // one down silently instead of leaving a ghost listener.
      session.abort();
      return;
    }
    sessionRef.current = session;
  }, [finishVoice, showToast]);

  const afterSave = useCallback(
    (event: LocalEvent, message: string) => {
      onSaved(event);
      if (!suppressSaveToast) showToast(message, event.id);
      onSaveComplete?.(event);
      void refreshEndOfDayNudge();
      void syncNow().catch(() => {});
      // Media backup runs on its own queue — text never waits for it.
      // On web this is the eager upload (blob: URIs die with the tab).
      void drainMediaOutbox().catch(() => {});
    },
    [onSaved, showToast, syncNow, suppressSaveToast, onSaveComplete],
  );

  const send = useCallback(() => {
    const noteText = text.trim();
    if (!noteText && !hasAttachments) return;

    const atts = attachments.map(attachmentPayload);
    let type: EventInput['type'] = 'note';
    if (!noteText && atts.length > 0) {
      type = atts.every((a) => a.kind === 'photo') ? 'photo' : 'file';
    }
    const data: Record<string, unknown> = {};
    if (noteText) data.text = noteText;
    if (atts.length > 0) data.attachments = atts;

    const event = saveEvent({ type, data, visibility: 'private' });
    lastNoteRef.current = noteText;
    setText('');
    setAttachments([]);

    // Queue photo/file bytes for cloud backup (Epic 2.3). Fire-and-forget:
    // the save above already returned and the toast is on its way.
    if (atts.length > 0) {
      void enqueueMediaUploads(event.id).catch(() => {});
    }

    // Intent detection runs on the text AFTER the plain save — the
    // proposal is a second, explicit, one-tap action.
    const found = detectIntents(noteText);
    setProposals(found);
    setProposalIdx(0);
    setAppointmentDate(null);

    afterSave(event, 'Saved to your story');
  }, [text, hasAttachments, attachments, afterSave]);

  const actionTap = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    if (hasText || hasAttachments) {
      send();
      return;
    }
    void startVoice();
  }, [listening, hasText, hasAttachments, send, startVoice, stopListening]);

  const undo = useCallback(() => {
    if (!toast?.undoId) return;
    const id = toast.undoId;
    deleteEvent(id);
    // Cancel any queued media backup and remove already-uploaded bytes.
    void purgeEventMedia(id).catch(() => {});
    onUnsaved(id);
    clearToastTimer();
    setToast({ message: 'Removed', undoId: null, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    void refreshEndOfDayNudge();
    void syncNow().catch(() => {});
  }, [toast, onUnsaved, syncNow]);

  const pickMood = useCallback(
    (id: MoodId) => {
      setMoodOpen(false);
      if (moodTimer.current) {
        clearTimeout(moodTimer.current);
        moodTimer.current = null;
      }
      const event = saveEvent({ type: 'mood', data: { mood: id }, visibility: 'private' });
      setLastMoodAt();
      setPillVisible(false);
      afterSave(event, `Saved — feeling ${id.toLowerCase()}`);
    },
    [afterSave],
  );

  const openMood = useCallback(() => {
    setMoodOpen(true);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMoodOpen(false), MOOD_POPOVER_MS);
  }, []);

  const advanceProposal = useCallback(() => {
    setAppointmentDate(null);
    const next = proposalIdx + 1;
    if (next < proposals.length) {
      setProposalIdx(next);
    } else {
      setProposals([]);
      setProposalIdx(0);
    }
  }, [proposalIdx, proposals.length]);

  const confirmProposal = useCallback(() => {
    const p = proposals[proposalIdx];
    if (!p) return;
    // buildEvent is invoked ONLY here — from her explicit "Save" tap.
    // Epic 4.5: the appointment proposal carries the picker's "When?"
    // date as the event's occurredAt (today when untouched).
    const opts =
      p.kind === 'appointment' ? { occurredAt: toISODate(appointmentDate ?? new Date()) } : undefined;
    const input = p.buildEvent(lastNoteRef.current, opts);
    const event = saveEvent({ ...input, visibility: 'private' });
    advanceProposal();
    afterSave(event, 'Saved to your story');
  }, [proposals, proposalIdx, appointmentDate, advanceProposal, afterSave]);

  const addAttachments = useCallback(
    async (pick: () => Promise<PendingAttachment[]>) => {
      setSheetOpen(false);
      try {
        const picked = await pick();
        if (picked.length > 0) {
          setAttachments((prev) => [...prev, ...picked].slice(0, 10));
        }
      } catch {
        showToast('Couldn’t add that — try again?', null);
      }
    },
    [showToast],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const gone = prev.filter((a) => a.id !== id);
      revokeAttachmentUris(prev.filter((a) => a.id === id));
      return gone;
    });
  }, []);

  const attachGlyph = (kind: PendingAttachment['kind']) =>
    kind === 'photo' ? '◉' : kind === 'video' ? '▶' : '▤';

  return (
    <View style={styles.zone}>
      {!hideMoodPill && pillVisible && !moodOpen ? (
        <Pressable
          style={styles.moodPill}
          onPress={openMood}
          accessibilityRole="button"
          accessibilityLabel="Log how you're feeling">
          <Text style={styles.moodPillText}>◐ How are you feeling?</Text>
        </Pressable>
      ) : null}

      {proposal ? (
        <View style={styles.proposal}>
          <View style={styles.proposalHead}>
            <Text style={styles.proposalGlyph}>✦</Text>
            <View style={styles.proposalCopy}>
              <Text style={styles.proposalTitle}>{proposal.title}</Text>
              <Text style={styles.proposalSub}>{proposal.subtitle}</Text>
            </View>
            <Pressable
              onPress={advanceProposal}
              accessibilityRole="button"
              accessibilityLabel="Dismiss suggestion"
              hitSlop={8}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
          <View style={styles.chipRow}>
            {proposal.labels.map((label) => (
              <View key={label} style={styles.schip} testID={`proposal-chip-${label}`}>
                <Text style={styles.schipText}>{label}</Text>
              </View>
            ))}
          </View>
          {proposal.kind === 'appointment' ? (
            <View style={styles.whenRow}>
              <Text style={styles.whenLabel}>When?</Text>
              <View style={styles.whenPicker}>
                <DatePickerField
                  value={appointmentDate ?? new Date()}
                  minimumDate={APPT_MIN_DATE}
                  maximumDate={APPT_MAX_DATE}
                  onChange={setAppointmentDate}
                  accessibilityLabel="Appointment date"
                  testID="appointment-date-picker"
                />
              </View>
            </View>
          ) : null}
          <View style={styles.proposalActions}>
            <Pressable
              style={styles.proposalSave}
              onPress={confirmProposal}
              accessibilityRole="button"
              accessibilityLabel={`Save: ${proposal.title}`}>
              <Text style={styles.proposalSaveText}>Save</Text>
            </Pressable>
            <Pressable
              style={styles.proposalSkip}
              onPress={advanceProposal}
              accessibilityRole="button"
              accessibilityLabel="Not now">
              <Text style={styles.proposalSkipText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {hasAttachments ? (
        <View style={styles.attachRow}>
          {attachments.map((a) => (
            <View key={a.id} style={styles.attachChip}>
              <Text style={styles.attachChipText} numberOfLines={1}>
                {attachGlyph(a.kind)} {a.name}
              </Text>
              <Pressable
                onPress={() => removeAttachment(a.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${a.name}`}
                hitSlop={8}>
                <Feather name="x" size={14} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          centerActions && styles.composerCentered,
          listening && styles.composerListening,
        ]}>
        <Pressable
          style={styles.circleBtn}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={photosOnly ? 'Add photo' : 'Add photo or file'}>
          <Feather name="plus" size={22} color={colors.ink} />
        </Pressable>
        <TextInput
          style={styles.field}
          value={text}
          onChangeText={setText}
          placeholder={listening ? `Listening… ${formatElapsed(dictationSecs)} — tap ■ to stop` : 'Save a moment…'}
          placeholderTextColor={colors.muted}
          multiline
          // 10-minute dictation ≈ 1,500 words ≈ 9,000 chars — the old
          // 2,000 cap would have silently truncated long entries.
          maxLength={12000}
          accessibilityLabel="Save a moment"
        />
        <Pressable
          style={[styles.circleBtn, (hasText || listening) && styles.circleBtnActive]}
          onPress={actionTap}
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Stop dictation' : hasText ? 'Save moment' : 'Dictate a moment'}>
          {listening ? (
            <View style={styles.stopWrap}>
              <View style={styles.recDot} />
              <Feather name="square" size={16} color="#fff" />
            </View>
          ) : hasText ? (
            <Feather name="arrow-up" size={22} color="#fff" />
          ) : (
            <Feather name="mic" size={22} color={colors.ink} />
          )}
        </Pressable>
      </View>

      <Modal
        visible={moodOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoodOpen(false)}>
        <Pressable style={styles.popoverBackdrop} onPress={() => setMoodOpen(false)}>
          <Pressable style={styles.popover} onPress={() => {}}>
            <View style={styles.popoverHead}>
              <Text style={styles.popoverTitle}>How are you feeling?</Text>
              <Pressable
                onPress={() => setMoodOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}>
                <Feather name="x" size={18} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.moodRow}>
              {MOODS.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.moodCell}
                  onPress={() => pickMood(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Feeling ${m.id}`}>
                  <View style={styles.moodCircle}>
                    <Text style={styles.moodGlyph}>{m.glyph}</Text>
                  </View>
                  <Text style={styles.moodLabel}>{m.id}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.popoverFoot}>Moods are private by default.</Text>
          </Pressable>
        </Pressable>
      </Modal>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        accessibilityLabel={photosOnly ? 'Add a photo' : 'Add to this moment'}>
        <Text style={styles.sheetTitle}>{photosOnly ? 'Add a photo' : 'Add to this moment'}</Text>
        <Text style={styles.sheetSub}>Private by default — only ever shared if you say so.</Text>
        <AttachOption
          icon="camera"
          title="Take a photo"
          subtitle="The bump, the nursery, the cravings"
          onPress={() => void addAttachments(pickFromCamera)}
        />
        <AttachOption
          icon="image"
          title="Photo library"
          subtitle="Ultrasound pics, bump photos, memories"
          onPress={() => void addAttachments(() => pickFromLibrary())}
        />
        {photosOnly ? null : (
          <AttachOption
            icon="file-text"
            title="Add files"
            subtitle="Scan reports, PDFs, notes from your visit"
            onPress={() => void addAttachments(pickDocument)}
          />
        )}
      </BottomSheet>

      {toast ? (
        <View style={styles.toast} testID="composer-toast">
          <Text style={styles.toastText}>{toast.message}</Text>
          {toast.undoId ? (
            <Pressable onPress={undo} accessibilityRole="button" accessibilityLabel="Undo save">
              <Text style={styles.toastUndo}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AttachOption({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: 'camera' | 'image' | 'film' | 'file-text';
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.attachOption} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.attachIcon}>
        <Feather name={icon} size={20} color={colors.coralDeep} />
      </View>
      <View>
        <Text style={styles.attachTitle}>{title}</Text>
        <Text style={styles.attachSub}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'relative',
  },
  moodPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  moodPillText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.ink,
  },
  proposal: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.blush,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  proposalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  proposalGlyph: {
    fontSize: 18,
    color: colors.gold,
    marginTop: 1,
  },
  proposalCopy: {
    flex: 1,
  },
  proposalTitle: {
    ...typeScale.headline,
    color: colors.ink,
  },
  proposalSub: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  schip: {
    backgroundColor: colors.blush,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  schipText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  whenLabel: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.muted,
  },
  whenPicker: {
    flex: 1,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  proposalSave: {
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  proposalSaveText: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: '#fff',
  },
  proposalSkip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  proposalSkipText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.muted,
  },
  attachRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: '100%',
  },
  attachChipText: {
    ...typeScale.footnote,
    fontWeight: '600',
    color: colors.ink,
    maxWidth: 220,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.sm,
    gap: spacing.sm,
    ...shadow.card,
  },
  // Floating "Log entry" mode: [+] and the action button sit on the
  // field's vertical center instead of the bottom edge.
  composerCentered: {
    alignItems: 'center',
  },
  composerListening: {
    borderColor: colors.coral,
    borderWidth: 2,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnActive: {
    backgroundColor: colors.ink,
  },
  field: {
    flex: 1,
    ...typeScale.body,
    color: colors.ink,
    minHeight: 44,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: 'center',
  },
  stopWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.coral,
  },
  popoverBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(43,36,30,0.25)',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingLeft: spacing.lg,
    paddingBottom: 170,
  },
  popover: {
    width: 296,
    maxWidth: '90%',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    ...shadow.card,
  },
  popoverHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  popoverTitle: {
    ...typeScale.headline,
    color: colors.ink,
  },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  moodCell: {
    alignItems: 'center',
    gap: 6,
  },
  moodCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  moodGlyph: {
    fontSize: 20,
    color: colors.ink,
  },
  moodLabel: {
    ...typeScale.footnote,
    color: colors.muted,
    fontWeight: '600',
  },
  popoverFoot: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  attachIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachTitle: {
    ...typeScale.headline,
    color: colors.ink,
  },
  sheetTitle: {
    ...typeScale.headline,
    color: colors.ink,
    marginBottom: 2,
  },
  sheetSub: {
    ...typeScale.footnote,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  attachSub: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: 2,
  },
  toast: {
    position: 'absolute',
    bottom: 78,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '90%',
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#fff',
  },
  toastUndo: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: colors.gold,
  },
});
