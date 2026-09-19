/**
 * Add report sheet (Logs-tab Add button, Anuraj-approved Sept 2026).
 *
 * File selector + upload section for lab reports, ultrasound printouts,
 * discharge summaries. "Choose file" opens the document picker;
 * "Scan document" opens the camera (a photo of the paper). Each file is
 * saved as a private timeline event and its bytes are queued for cloud
 * backup through the same media outbox the composer uses — the ✓ means
 * "saved to your timeline", uploads finish in the background.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../components/BottomSheet';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { saveEvent } from '../sync/store';
import { drainMediaOutbox, enqueueMediaUploads } from '../sync/media';
import type { EventAttachment, EventInput, LocalEvent } from '../lib/types';
import { pickDocument, pickFromCamera, type PendingAttachment } from '../composer/attachments';

const MAX_FILES = 10;

interface ReportRow {
  id: string;
  name: string;
  done: boolean;
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

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires once per saved file (timeline prepends each). */
  onSaved: (event: LocalEvent) => void;
}

export default function ReportSheet({ visible, onClose, onSaved }: ReportSheetProps) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // The sheet stays mounted while hidden — every session starts with an
  // empty file list, not the previous uploads.
  useEffect(() => {
    if (visible) {
      setRows([]);
      setSaving(false);
      setToast(null);
      progress.setValue(0);
    }
  }, [visible, progress]);

  const addPicked = useCallback(
    async (pick: () => Promise<PendingAttachment[]>) => {
      if (busy.current || rows.length >= MAX_FILES) return;
      busy.current = true;
      setSaving(true);
      progress.setValue(0);
      // Gentle progress while the save lands; the ✓ fires when the event
      // is in the store and its bytes are queued for backup.
      Animated.timing(progress, {
        toValue: 0.9,
        duration: 600,
        useNativeDriver: false,
      }).start();
      try {
        const picked = await pick();
        for (const a of picked.slice(0, MAX_FILES - rows.length)) {
          const atts = [attachmentPayload(a)];
          // Anuraj's entry-typing rule: Add report → ALWAYS a Report entry,
          // whatever the attachment kind (photo of the paper or document file).
          const type: EventInput['type'] = 'report';
          const event = saveEvent({
            type,
            // The 'report' category powers the Reports filter chip (and,
            // in the next phase, the Report summary card on the timeline).
            data: { text: a.name, attachments: atts, category: 'report' },
            visibility: 'private',
          });
          // Bytes upload on their own queue — the save above already returned.
          // Same eager drain the composer uses (on web, blob: URIs die with
          // the tab), so the bytes actually leave even if she closes the app.
          void enqueueMediaUploads(event.id).catch(() => {});
          void drainMediaOutbox().catch(() => {});
          onSaved(event);
          setRows((prev) => [...prev, { id: a.id, name: a.name, done: true }]);
        }
      } catch {
        setToast('Couldn’t add that — try again?');
      } finally {
        Animated.timing(progress, {
          toValue: 1,
          duration: 250,
          useNativeDriver: false,
        }).start(() => setSaving(false));
        busy.current = false;
      }
    },
    [rows.length, onSaved, progress],
  );

  const done = useCallback(() => {
    if (rows.length === 0) {
      onClose();
      return;
    }
    setToast('Report saved to your story');
    toastTimer.current = setTimeout(onClose, 1500);
  }, [rows.length, onClose]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Add a report"
      testID="report-sheet">
      <Text style={styles.title}>Add report</Text>
      <Text style={styles.lede}>Lab reports, ultrasound printouts, discharge summaries.</Text>

      <View style={styles.pickRow}>
        <Pressable
          onPress={() => void addPicked(pickDocument)}
          accessibilityRole="button"
          accessibilityLabel="Choose file"
          testID="report-choose-file"
          style={({ pressed }) => [styles.pickBtn, styles.pickGhost, pressed && styles.pickPressed]}>
          <Text style={styles.pickGhostText}>Choose file</Text>
        </Pressable>
        <Pressable
          onPress={() => void addPicked(pickFromCamera)}
          accessibilityRole="button"
          accessibilityLabel="Scan document"
          testID="report-scan"
          style={({ pressed }) => [styles.pickBtn, styles.pickGhost, pressed && styles.pickPressed]}>
          <Text style={styles.pickGhostText}>Scan document</Text>
        </Pressable>
      </View>

      {rows.length === 0 && !saving ? (
        <View style={styles.emptyFiles} testID="report-empty">
          <Text style={styles.emptyFilesText}>No files yet — your uploads will appear here.</Text>
        </View>
      ) : null}

      {rows.map((r) => (
        <View key={r.id} style={[styles.fileRow, r.done && styles.fileRowDone]} testID={`report-row-${r.id}`}>
          <View style={styles.fileIcon}>
            <Feather name="file-text" size={18} color={colors.blue} />
          </View>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {r.name}
            </Text>
            {r.done ? null : (
              <View style={styles.progress}>
                <Animated.View style={[styles.bar, { width: barWidth }]} />
              </View>
            )}
          </View>
          {r.done ? (
            <View style={styles.doneBadge} testID={`report-done-${r.id}`}>
              <Feather name="check" size={14} color={colors.sageDeep} />
            </View>
          ) : null}
        </View>
      ))}
      {saving && rows.length === 0 ? (
        <View style={styles.fileRow} testID="report-row-saving">
          <View style={styles.fileIcon}>
            <Feather name="file-text" size={18} color={colors.blue} />
          </View>
          <View style={styles.fileInfo}>
            <View style={styles.progress}>
              <Animated.View style={[styles.bar, { width: barWidth }]} />
            </View>
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={done}
        accessibilityRole="button"
        accessibilityLabel="Done"
        testID="report-done"
        style={({ pressed }) => [styles.done, pressed && styles.donePressed]}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
      <Text style={styles.priv}>🔒 Private — only you can see this</Text>

      {toast ? (
        <View style={styles.toast} testID="report-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: 'Georgia',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.ink,
  },
  lede: {
    ...typeScale.footnote,
    color: colors.muted,
    lineHeight: 21,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  pickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pickBtn: {
    flex: 1,
    borderRadius: radii.card,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickGhost: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  pickPressed: {
    opacity: 0.7,
  },
  pickGhostText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  emptyFiles: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyFilesText: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  fileRowDone: {
    // Keeps layout identical; the ✓ replaces the progress bar.
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.blueTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 6,
  },
  progress: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.sage,
  },
  doneBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    backgroundColor: colors.coral,
    borderRadius: radii.card,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  donePressed: {
    backgroundColor: colors.coralDeep,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  priv: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  toast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
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
    textAlign: 'center',
  },
});
