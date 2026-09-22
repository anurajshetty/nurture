/**
 * FloatingComposer — the "Log entry" surface for the Logs-tab Add button.
 *
 * Mockup 33-entry-sharing device A (Anuraj approved Sept 21, 2026):
 * the new-log composer is TEXT-ONLY — kicker "New log", title "What's
 * on your mind?", lede, a 120pt textarea, a footer row with the real
 * Shared switch (starting at the global default), and a full-width
 * "Save log". After a save the composer settles away and the
 * sharing-aware toast confirms it ("Log saved — shared with your
 * partner." / "Log saved — only you can see it.").
 *
 * The form itself lives in NewLogForm; this component is the overlay
 * host (scrim + toast), preserving the AddMenu wiring.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import NewLogForm, {
  NEW_LOG_SAVE_TOAST_PRIVATE,
  NEW_LOG_SAVE_TOAST_SHARED,
} from './NewLogForm';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { isSharedVisibility } from '../partner/sharing';
import type { LocalEvent } from '../lib/types';

const TOAST_MS = 2500;

export interface FloatingComposerProps {
  visible: boolean;
  onClose: () => void;
  /** Prepends the saved event to the timeline (optimistic). */
  onSaved: (event: LocalEvent) => void;
  /** Unused by the text-only form; kept for AddMenu wiring. */
  onUnsaved: (id: string) => void;
}

export default function FloatingComposer({ visible, onClose, onSaved }: FloatingComposerProps) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // The component stays in the tree rendering null while hidden, so its
  // state survives between sessions — reset the toast on every open,
  // otherwise the second Log entry would show a stale toast.
  useEffect(() => {
    if (visible) {
      setToast(null);
    } else if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [visible]);

  const handleSaved = useCallback(
    (event: LocalEvent) => {
      onClose();
      onSaved(event);
      setToast(
        isSharedVisibility(event.visibility)
          ? NEW_LOG_SAVE_TOAST_SHARED
          : NEW_LOG_SAVE_TOAST_PRIVATE,
      );
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), TOAST_MS);
    },
    [onClose, onSaved],
  );

  if (!visible && !toast) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="floating-composer">
      {visible ? (
        <NewLogForm onSaved={handleSaved} onClose={onClose} />
      ) : null}
      {toast ? (
        <View style={styles.toast} testID="floating-composer-toast" pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
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
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xxxl,
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  toastText: {
    ...typeScale.subhead,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
