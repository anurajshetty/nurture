/**
 * AddMenu — the Logs-tab Add button (Anuraj-approved Sept 2026).
 *
 * One centered circular + button floating above the Logs tab bar. It
 * REPLACES the old "Save a moment…" composer bar. Tap: a light scrim and
 * three pills (Appointment / Add report / Log entry). Tap ×, the scrim,
 * or any pill to fold the menu away; a pill opens its sheet.
 *
 * Rendered as a direct child of the Logs Screen: the button floats
 * absolutely over the feed (transparent — no box, no background, zero
 * in-flow space; the feed gets maximum room) while the menu overlay is
 * absolutely positioned over the whole screen, painted above the timeline
 * but below the button. The timeline list carries bottom padding so its
 * last cards never hide under the floating button.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radii, type as typeScale, shadow } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';
import AppointmentSheet from './AppointmentSheet';
import ReportSheet from './ReportSheet';
import FloatingComposer from './FloatingComposer';

type SheetKind = 'appointment' | 'report' | 'log' | null;

function MenuPill({
  label,
  icon,
  iconBg,
  testID,
  onPress,
}: {
  label: string;
  icon: 'list' | 'file-text' | 'edit-3';
  iconBg: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}>
      <View
        style={[styles.pillIcon, { backgroundColor: iconBg }]}
        accessibilityElementsHidden>
        <Feather name={icon} size={24} color="#fff" />
      </View>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

export interface AddMenuProps {
  /** Prepends a saved event to the timeline (optimistic). */
  onSaved: (event: LocalEvent) => void;
  /** Removes the event from the timeline after Undo. */
  onUnsaved: (id: string) => void;
}

export default function AddMenu({ onSaved, onUnsaved }: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const closeMenu = useCallback(() => setOpen(false), []);
  const pick = useCallback((kind: Exclude<SheetKind, null>) => {
    setOpen(false);
    setSheet(kind);
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  return (
    <>
      {open ? (
        <View style={styles.menuOverlay} testID="add-menu" pointerEvents="box-none">
          <Pressable
            style={styles.scrim}
            onPress={closeMenu}
            accessibilityRole="button"
            accessibilityLabel="Close add menu"
            testID="add-menu-scrim"
          />
          <View style={styles.pills} pointerEvents="box-none">
            <MenuPill label="Appointment" icon="list" iconBg="#8E7CC3" testID="add-menu-pill-appointment" onPress={() => pick('appointment')} />
            <MenuPill label="Add report" icon="file-text" iconBg="#7FA8C9" testID="add-menu-pill-report" onPress={() => pick('report')} />
            <MenuPill label="Log entry" icon="edit-3" iconBg="#93B192" testID="add-menu-pill-log" onPress={() => pick('log')} />
          </View>
        </View>
      ) : null}

      <View style={styles.bar} pointerEvents="box-none">
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close add menu' : 'Add'}
          testID="logs-add-button"
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}>
          <Feather name={open ? 'x' : 'plus'} size={30} color="#fff" />
        </Pressable>
      </View>

      <AppointmentSheet visible={sheet === 'appointment'} onClose={closeSheet} onSaved={onSaved} />
      <ReportSheet visible={sheet === 'report'} onClose={closeSheet} onSaved={onSaved} />
      <FloatingComposer
        visible={sheet === 'log'}
        onClose={closeSheet}
        onSaved={onSaved}
        onUnsaved={onUnsaved}
      />
    </>
  );
}

const styles = StyleSheet.create({
  /** Screen-level overlay: above the timeline, below the + button. */
  menuOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  pills: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 108,
    alignItems: 'center',
    gap: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    backgroundColor: '#fff',
    borderRadius: radii.chip,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 28,
    minHeight: 84,
    minWidth: 250,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  pillIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: {
    backgroundColor: colors.bg,
  },
  pillText: {
    ...typeScale.headline,
    fontWeight: '700',
    color: colors.ink,
  },
  /**
   * Floating button: absolutely positioned over the feed — transparent,
   * no container, no background, zero in-flow space (Anuraj Sept 2026:
   * feed gets maximum space). Above the menu scrim (zIndex 10): the + / x
   * stays tappable while the menu is open.
   */
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    zIndex: 11,
    alignItems: 'center',
  },
  addButton: {
    // 72px: ~two-thirds of the old 88px (Anuraj Sept 2026 — the old
    // button ate too much feed). Still well above the 44pt touch target.
    // The × open-state keeps this same size.
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  addButtonPressed: {
    backgroundColor: colors.coralDeep,
  },
});
