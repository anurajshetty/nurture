/**
 * NewLogForm — the text-only new-log composer (mockup 33-entry-sharing
 * device A, Anuraj approved Sept 21, 2026).
 *
 * Mockup structure: kicker "New log", title "What's on your mind?",
 * lede "A quick note — just write, and save.", a 120pt textarea,
 * a footer row (hint + real Shared switch), and a full-width primary
 * "Save". The switch starts at the global default (ON unless she
 * changed it). The handshake explainer sits above the card, shown once
 * — not repeated per render.
 *
 * Sheet chrome comes from the shared BottomSheet (Anuraj, Sept 2026):
 * grabber pill + pull-down-to-dismiss, safe-area bottom padding, and
 * the whole-app KeyboardAvoid — no per-sheet close button, no custom
 * overlay. Content scrolls inside the sheet so nothing is clipped when
 * the keyboard is up.
 *
 * Save is disabled until there is text. Toasts (parent renders them):
 * "Log saved — shared with your partner." /
 * "Log saved — only you can see it."
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, minTouch, radii, spacing, type } from '../theme/tokens';
import BottomSheet from '../components/BottomSheet';
import SharedSwitch from '../components/SharedSwitch';
import { HANDSHAKE_COPY, shareToggleLabels } from '../partner/sharing';
import { readShareDefaultSync } from '../partner/shareStore';
import { saveEventAwaitingIdentity } from '../sync/store';
import type { LocalEvent } from '../lib/types';

export interface NewLogFormProps {
  /** Called with the saved event after a successful save. */
  onSaved: (event: LocalEvent) => void;
  /** Close without saving (pull-down / scrim). */
  onClose: () => void;
}

export const NEW_LOG_SAVE_TOAST_SHARED = 'Log saved — shared with your partner.';
export const NEW_LOG_SAVE_TOAST_PRIVATE = 'Log saved — only you can see it.';

export default function NewLogForm({ onSaved, onClose }: NewLogFormProps) {
  const [text, setText] = useState('');
  // Switch starts at the global default (mockup device A: ON).
  const [shared, setShared] = useState<boolean>(() => readShareDefaultSync());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const canSave = text.trim().length > 0 && !saving;
  const labels = shareToggleLabels(shared);

  const handleSave = async () => {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      // Creation gate (sync bug fix, Sept 2026): await identity resolution
      // before stamping user_id — never queue a row that can never sync.
      const event = await saveEventAwaitingIdentity({
        type: 'note',
        data: { text: clean },
        visibility: shared ? 'shared' : 'private',
      });
      onSaved(event);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      testID="new-log-overlay"
      accessibilityLabel="New log"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        testID="new-log-scroll"
      >
        <View style={styles.explainerWrap} testID="new-log-explainer">
          <Text style={styles.explainerText}>{HANDSHAKE_COPY}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>New log</Text>
          <Text style={styles.title}>What&apos;s on your mind?</Text>
          <Text style={styles.lede}>A quick note — just write, and save.</Text>
        </View>
        <TextInput
          ref={inputRef}
          testID="new-log-input"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Write it down…"
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          returnKeyType="default"
          accessibilityLabel="Log text"
        />
        <View style={styles.footer} testID="new-log-share-row">
          <View style={styles.shareText}>
            <Text style={styles.shareLabel}>{labels.status}</Text>
            <Text style={styles.hint}>{labels.hint}</Text>
          </View>
          <SharedSwitch
            value={shared}
            onChange={setShared}
            accessibilityLabel="Share this log with your partner"
            testID="new-log-share-switch"
            compact
          />
        </View>
        <Pressable
          testID="new-log-save"
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save"
          accessibilityState={{ disabled: !canSave }}
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        >
          <Text style={[styles.saveLabel, !canSave && styles.saveLabelDisabled]}>
            Save
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  explainerWrap: {
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  explainerText: {
    ...type.footnote,
    color: colors.coralDeep,
    textAlign: 'center',
  },
  headerText: {
    marginBottom: spacing.md,
  },
  kicker: {
    ...type.footnote,
    color: colors.coralDeep,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  title: {
    ...type.title,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  lede: {
    ...type.body,
    color: colors.muted,
  },
  input: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.bg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 120,
    maxHeight: 220,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  hint: {
    ...type.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  shareText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  shareLabel: {
    ...type.body,
    color: colors.ink,
    fontWeight: '700',
  },
  saveBtn: {
    backgroundColor: colors.coral,
    borderRadius: radii.button,
    minHeight: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: colors.line,
  },
  saveLabel: {
    ...type.headline,
    color: '#FFFFFF',
  },
  saveLabelDisabled: {
    color: colors.muted,
  },
});
