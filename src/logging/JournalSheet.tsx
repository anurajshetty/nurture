/**
 * Journal notes sheet (Epic 4, slice 4.2).
 *
 * A free-text journal entry she can open anytime: a few words, optional
 * photos and files (same attachment ceiling as the universal composer),
 * saved privately to her timeline. Built in the approved sheet
 * language (mirrors the sh-question sheet from the 04-logging mockup:
 * grab handle, serif title, warm sub-copy, textarea, coral Save button).
 *
 * Attachments are icon-only (Anuraj: the icons alone are understandable):
 * a horizontal strip of three 56pt tinted tiles — camera, photo library,
 * paperclip — with no visible text labels (accessibility labels stay for
 * VoiceOver). The camera tile uses the filled MaterialCommunityIcons
 * camera: the Feather outline read as a record dot at phone size (Anuraj).
 *
 * TWO circular voice/save affordances (Anuraj): a mic INSIDE the text box
 * for voice input (tap to dictate, tap the stop square to end), PLUS the
 * circular save button at the end of the attachment row — mic by default,
 * a stop square while listening, a send arrow once there is text in the
 * box OR a photo/file attached. Send saves the note.
 *
 * Both mics start the composer's continuous dictation
 * (expo-speech-recognition, on-device where supported): the transcript
 * streams into the text field for her review. Typed words are kept;
 * dictation appends after them. Errors surface as one quiet inline
 * caption under the box.
 *
 * Write path matches the composer note shape exactly so the timeline
 * renders uniformly: `saveEvent({ type: 'note', data: { text,
 * attachments? }, visibility })`, then fire-and-forget
 * `enqueueMediaUploads` for cloud backup (Epic 2.3 seam). The visibility
 * picker (Epic 7, §7.1) defaults journal notes to private — "a few words,
 * just for you" — and she can mark a note shared any time.
 *
 * Draft autosave: the text is persisted (debounced) to the local kv store
 * under 'draft:journal' on every keystroke, restored the next time the
 * sheet opens (including after an app restart), and cleared on save — a
 * note is never lost to a crash or navigating away. Only the words are
 * drafted; photo attachments are session-local and must be re-added.
 *
 * No medical content anywhere. Private by default.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomSheet } from '../components';
import Segmented from '../components/Segmented';
import { colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';
import { kvDelete, kvGet, kvSet } from '../lib/db';
import { saveEvent } from '../sync/store';
import { enqueueMediaUploads } from '../sync/media';
import {
  defaultVisibilityForType,
  visibilityNote,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
} from '../partner/visibility';
import {
  pickDocument,
  pickFromCamera,
  pickFromLibrary,
  revokeAttachmentUris,
  type PendingAttachment,
} from '../composer/attachments';
import { startDictation } from '../composer/voice';
import type { EventAttachment, Visibility } from '../lib/types';

export type JournalSheetProps = {
  visible: boolean;
  onClose: () => void;
};

/** Local kv key for the in-progress journal draft. */
export const JOURNAL_DRAFT_KEY = 'draft:journal';

/** Keystroke debounce before the draft hits the local store. */
const DRAFT_DEBOUNCE_MS = 600;

/** Composer allows up to 10 attachments; journal keeps the same ceiling. */
const MAX_ATTACHMENTS = 10;

/** Reads the drafted words back, or '' when there is no draft. */
function readDraft(): string {
  try {
    const raw = kvGet(JOURNAL_DRAFT_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

/** Persists the drafted words; an empty draft removes the key. */
function writeDraft(text: string): void {
  try {
    if (text) {
      kvSet(JOURNAL_DRAFT_KEY, JSON.stringify({ text, updatedAt: Date.now() }));
    } else {
      kvDelete(JOURNAL_DRAFT_KEY);
    }
  } catch {
    // Drafting is best-effort; a failed write must never block her.
  }
}

/** Same attachment payload shape the composer saves (Epic 2.1). */
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

export default function JournalSheet({ visible, onClose }: JournalSheetProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Per-entry visibility (Epic 7, §7.1): journal notes default private —
  // "a few words, just for you". Changeable any time from the entry.
  const [visibility, setVisibility] = useState<Visibility>(() => defaultVisibilityForType('note'));
  const restoredRef = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dictation session bookkeeping (mirrors the composer's pattern).
  const sessionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const sessionSeq = useRef(0);
  const listeningRef = useRef(false);
  // Words she typed before tapping the mic — dictation appends after them.
  const voiceBaseRef = useRef('');

  // Restore the draft the first time the sheet opens — this covers an app
  // restart, since the words live in the local kv store, not in memory.
  useEffect(() => {
    if (visible && !restoredRef.current) {
      restoredRef.current = true;
      const draft = readDraft();
      if (draft) setText(draft);
    }
  }, [visible]);

  // Autosave on every keystroke (debounced). The component stays mounted
  // while the sheet is dismissed, so closing without saving still lands
  // the latest words in the store.
  useEffect(() => {
    if (!restoredRef.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => writeDraft(text), DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [text]);

  // Release session-local object URLs when the sheet unmounts (web),
  // and abort any in-flight dictation so it can't write after unmount.
  useEffect(() => {
    return () => {
      sessionRef.current?.abort();
      sessionRef.current = null;
      listeningRef.current = false;
      setAttachments((prev) => {
        if (prev.length > 0) revokeAttachmentUris(prev);
        return prev;
      });
    };
  }, []);

  /** Dictation transcript joins after whatever she already typed. */
  const applyVoiceText = useCallback((transcript: string) => {
    const base = voiceBaseRef.current.trimEnd();
    const t = transcript.trim();
    setText(t ? (base ? `${base} ${t}` : t) : base);
  }, []);

  // A dictation session finished on its own terms (final/error). Stale
  // sessions — superseded by a newer one — must not touch the field.
  const finishVoice = useCallback(
    (id: number, finalText?: string) => {
      if (id !== sessionSeq.current) return;
      sessionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      if (finalText !== undefined) applyVoiceText(finalText);
    },
    [applyVoiceText],
  );

  const stopListening = useCallback(() => {
    // User tapped stop: ask the OS for its final result, then let the
    // session's onFinal land it via finishVoice. The session id stays
    // valid so that in-flight final isn't treated as stale.
    sessionRef.current?.stop();
    sessionRef.current = null;
    listeningRef.current = false;
    setListening(false);
  }, []);

  const startVoice = useCallback(async () => {
    if (listeningRef.current) return;
    const id = sessionSeq.current + 1;
    sessionSeq.current = id;
    listeningRef.current = true;
    setListening(true);
    setVoiceError(null);
    voiceBaseRef.current = text;
    const session = await startDictation({
      onInterim: (t) => {
        if (id === sessionSeq.current) applyVoiceText(t);
      },
      onFinal: (t) => finishVoice(id, t),
      onError: (message) => {
        const fresh = id === sessionSeq.current;
        finishVoice(id);
        if (fresh) setVoiceError(message);
      },
      onLimitReached: (message) => setVoiceError(message),
    });
    if (!session) {
      // Permission denied or unavailable — the kind error is already
      // showing via voiceError.
      finishVoice(id);
      return;
    }
    if (!listeningRef.current || id !== sessionSeq.current) {
      // She tapped stop while the permission dialog was up, or a newer
      // session already started — tear this one down silently instead of
      // leaving a ghost listener.
      session.abort();
      return;
    }
    sessionRef.current = session;
  }, [finishVoice, applyVoiceText, text]);

  /** A live session must never outlive the sheet's save or close. */
  const endVoiceSession = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    listeningRef.current = false;
    setListening(false);
    setVoiceError(null);
  }, []);

  const canSave = text.trim().length > 0 || attachments.length > 0;
  
  const addAttachments = useCallback(
    async (pick: () => Promise<PendingAttachment[]>) => {
      try {
        const picked = await pick();
        if (picked.length > 0) {
          setAttachments((prev) => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
        }
      } catch {
        // She backed out or the picker failed — the sheet stays as it was.
      }
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const gone = prev.filter((a) => a.id !== id);
      revokeAttachmentUris(prev.filter((a) => a.id === id));
      return gone;
    });
  }, []);

  const handleSave = useCallback(() => {
    const noteText = text.trim();
    if ((!noteText && attachments.length === 0) || saving) return;
    endVoiceSession();
    setSaving(true);
    try {
      const atts = attachments.map(attachmentPayload);
      const data: Record<string, unknown> = { text: noteText };
      if (atts.length > 0) data.attachments = atts;
      // Identical to the composer note write, with the chosen visibility.
      const event = saveEvent({ type: 'note', data, visibility });
      try {
        kvDelete(JOURNAL_DRAFT_KEY);
      } catch {
        // The save already landed; a stale draft key is harmless.
      }
      setText('');
      setAttachments([]);
      // Cloud backup of the bytes, fire-and-forget: the save above already
      // returned, text never waits for media (Epic 2.3 seam).
      if (atts.length > 0) {
        void enqueueMediaUploads(event.id).catch(() => {});
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }, [text, attachments, saving, visibility, onClose, endVoiceSession]);

  const handleClose = useCallback(() => {
    endVoiceSession();
    onClose();
  }, [endVoiceSession, onClose]);

  /**
   * In-textbox mic (Anuraj): voice input straight into the field — tap to
   * start dictation, tap the stop square to end it. The circular save
   * button mirrors the listening state; either one stops.
   */
  const fieldMicTap = useCallback(() => {
    setVoiceError(null);
    if (listeningRef.current) {
      stopListening();
      return;
    }
    void startVoice();
  }, [stopListening, startVoice]);

  /**
   * One circular action button (Anuraj): mic by default, stop square while
   * listening, send arrow once there is text OR an attachment — send saves
   * exactly like the old Save button did.
   */
  const actionTap = useCallback(() => {
    setVoiceError(null);
    if (listeningRef.current) {
      stopListening();
      return;
    }
    if (canSave) {
      handleSave();
      return;
    }
    void startVoice();
  }, [stopListening, startVoice, canSave, handleSave]);

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      testID="journal-sheet"
      accessibilityLabel="Journal note"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.titles}>
            <Text style={styles.title}>Journal note</Text>
            <Text style={styles.sub}>A few words, just for you — whenever you like.</Text>
          </View>
          <Pressable
            testID="journal-close"
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close journal"
            hitSlop={12}
            style={styles.closeBtn}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        </View>

        <View style={[styles.fieldWrap, listening && styles.fieldWrapListening]}>
          <TextInput
            testID="journal-text-input"
            accessibilityLabel="Journal note text"
            value={text}
            onChangeText={setText}
            placeholder="What's on your mind today?"
            placeholderTextColor="#B3A89B"
            multiline
            textAlignVertical="top"
            style={styles.fieldInput}
          />
          <Pressable
            testID="journal-field-mic"
            onPress={fieldMicTap}
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop dictation' : 'Dictate into note'}
            hitSlop={8}
            style={styles.fieldMicBtn}
          >
            {listening ? (
              <View style={styles.fieldMicStop} />
            ) : (
              <Feather name="mic" size={20} color={colors.coralDeep} />
            )}
          </Pressable>
        </View>
        {voiceError ? (
          <Text testID="journal-voice-error" style={styles.voiceError}>
            {voiceError}
          </Text>
        ) : null}

        <Text style={styles.sectionLabel}>Attachments</Text>
        <View style={styles.actionRow}>
          <View style={styles.attachIconStrip}>
            <AttachIconButton
              testID="journal-attach-camera"
              icon="camera"
              set="mci"
              tileBg={colors.blush}
              iconColor={colors.coralDeep}
              accessibilityLabel="Take photo"
              onPress={() => void addAttachments(pickFromCamera)}
            />
            <AttachIconButton
              testID="journal-attach-library"
              icon="image"
              tileBg={colors.sageTint}
              iconColor={colors.sageDeep}
              accessibilityLabel="Choose photo"
              onPress={() => void addAttachments(pickFromLibrary)}
            />
            <AttachIconButton
              testID="journal-attach-file"
              icon="paperclip"
              tileBg={colors.line}
              iconColor={colors.muted}
              accessibilityLabel="Attach file"
              onPress={() => void addAttachments(pickDocument)}
            />
          </View>
          <Pressable
            testID="journal-voice"
            onPress={actionTap}
            accessibilityRole="button"
            accessibilityLabel={
              listening ? 'Stop voice recording' : canSave ? 'Save note' : 'Record voice note'
            }
            hitSlop={6}
            style={[
              styles.actionBtn,
              { backgroundColor: listening || canSave ? colors.coral : colors.blush },
            ]}
          >
            {listening ? (
              <View style={styles.stopSquare} />
            ) : (
              <Feather
                name={canSave ? 'send' : 'mic'}
                size={22}
                color={canSave ? '#fff' : colors.coralDeep}
              />
            )}
          </Pressable>
        </View>

        {attachments.map((a) => (
          <View key={a.id} testID="journal-attachment" style={styles.attRow}>
            {a.kind === 'file' ? (
              <View style={[styles.attThumb, styles.attFileTile]}>
                <Feather name="file-text" size={22} color={colors.muted} />
              </View>
            ) : (
              <Image source={{ uri: a.uri }} style={styles.attThumb} />
            )}
            <Text style={styles.attName} numberOfLines={1}>
              {a.name}
            </Text>
            <Pressable
              testID={`journal-remove-attachment-${a.id}`}
              onPress={() => removeAttachment(a.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${a.name}`}
              hitSlop={12}
              style={styles.attRemove}
            >
              <Text style={styles.attRemoveGlyph}>✕</Text>
            </Pressable>
          </View>
        ))}

        <Text style={styles.sectionLabel}>Who can see this</Text>
        <Segmented
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
          labels={VISIBILITY_LABELS}
          accessibilityLabel="Entry visibility"
          testID="journal-visibility"
        />
        <Text style={styles.visibilityNote} testID="journal-visibility-note">
          {visibilityNote(visibility)}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

/** Icon-only attachment button (Anuraj: the icons alone are understandable).
 *  The visible text label is gone, but the accessibility label stays so
 *  VoiceOver still announces what each button does. */
function AttachIconButton({
  testID,
  icon,
  set = 'feather',
  tileBg,
  iconColor,
  accessibilityLabel,
  onPress,
}: {
  testID: string;
  icon: 'camera' | 'image' | 'paperclip';
  /** 'mci' renders the bolder filled MaterialCommunityIcons glyph. */
  set?: 'feather' | 'mci';
  tileBg: string;
  iconColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.attachIconBtn,
        { backgroundColor: tileBg },
        pressed && styles.attachRowPressed,
      ]}
    >
      {set === 'mci' ? (
        <MaterialCommunityIcons name={icon} size={26} color={iconColor} />
      ) : (
        <Feather name={icon} size={24} color={iconColor} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  titles: {
    flex: 1,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
  },
  sub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 4,
    lineHeight: 20,
  },
  closeBtn: {
    minWidth: minTouch,
    minHeight: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  closeGlyph: {
    fontSize: 18,
    color: colors.muted,
    fontWeight: '600',
  },
  fieldWrap: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.card,
    marginTop: spacing.sm,
    minHeight: 110,
  },
  fieldWrapListening: {
    borderColor: colors.coral,
  },
  fieldInput: {
    paddingLeft: 14,
    paddingRight: 58,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.ink,
    minHeight: 110,
  },
  /** In-textbox mic: 44pt target, bottom-right inside the field. */
  fieldMicBtn: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldMicStop: {
    width: 13,
    height: 13,
    borderRadius: 3,
    backgroundColor: colors.coralDeep,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  stopSquare: {
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  attachRowPressed: {
    opacity: 0.55,
  },
  attachIconStrip: {
    flexDirection: 'row',
    gap: spacing.md,
    flex: 1,
  },
  attachIconBtn: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceError: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  attRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radii.card,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  attThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.line,
  },
  attFileTile: {
    backgroundColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attName: {
    flex: 1,
    ...typeScale.subhead,
    color: colors.ink,
  },
  attRemove: {
    minWidth: minTouch,
    minHeight: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attRemoveGlyph: {
    fontSize: 15,
    color: colors.muted,
    fontWeight: '700',
  },
  visibilityNote: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 19,
  },
});
