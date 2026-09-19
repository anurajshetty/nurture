/**
 * FloatingComposer — the "Log entry" surface for the Logs-tab Add button
 * (Anuraj-approved Sept 2026).
 *
 * The real in-app Composer floats above a light scrim — no bottom-sheet
 * chrome, no "Log entry" title. Floating mode hides the mood pill (kept in
 * the markup for a one-line return), offers photos only from [+], and
 * centers the [+] / action buttons. After a save the composer settles
 * away and a warm "Saved to your story" toast confirms it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Composer from '../composer/Composer';
import { colors, radii, spacing, shadow, type as typeScale } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';

const TOAST_MS = 2500;

export interface FloatingComposerProps {
  visible: boolean;
  onClose: () => void;
  /** Prepends the saved event to the timeline (optimistic). */
  onSaved: (event: LocalEvent) => void;
  /** Removes the event from the timeline after Undo. */
  onUnsaved: (id: string) => void;
}

export default function FloatingComposer({ visible, onClose, onSaved, onUnsaved }: FloatingComposerProps) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // The component stays in the tree rendering null while hidden, so its
  // state survives between sessions — reset the post-save state on every
  // open, otherwise the second Log entry would show a stale toast.
  useEffect(() => {
    if (visible) {
      setSaved(false);
    } else if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [visible]);

  const handleSaveComplete = useCallback(() => {
    // Settle the composer away, toast, then hand control back.
    setSaved(true);
    timer.current = setTimeout(onClose, TOAST_MS);
  }, [onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="floating-composer">
      {saved ? null : (
        <>
          <Pressable
            style={styles.scrim}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close log entry"
            testID="floating-composer-scrim"
          />
          <View style={styles.float} pointerEvents="box-none">
            <View style={styles.composerCard}>
              <Composer
                onSaved={onSaved}
                onUnsaved={onUnsaved}
                hideMoodPill
                photosOnly
                centerActions
                suppressSaveToast
                onSaveComplete={handleSaveComplete}
              />
            </View>
          </View>
        </>
      )}
      {saved ? (
        <View style={styles.toast} testID="floating-composer-toast">
          <Text style={styles.toastText}>Saved to your story</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  float: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  composerCard: {
    // The Composer brings its own card styling; this just anchors it.
  },
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 140,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#fff',
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
    ...shadow.card,
  },
});
