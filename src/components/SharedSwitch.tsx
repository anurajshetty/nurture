/**
 * SharedSwitch — the locked iOS-style toggle used everywhere partner
 * sharing is switched (mockup 33 partners-card + 33-entry-sharing,
 * Anuraj approved Sept 21, 2026).
 *
 * Locked treatment: 44pt minimum hit area on the button, 51x31 track
 * inside, coral ON (#E8927C track) / light-gray OFF (#D9D2C4), white
 * knob that slides left/right, inner shadow on the OFF track. Color
 * values copied verbatim from the approved mockup CSS:
 * `.sw` (44x44, transparent) / `.sw-track` (51x31, radius 16) /
 * `.sw.on .sw-track` (#E8927C) / `.sw-knob` (27x27 at 2px inset).
 *
 * A real toggle: flips `value` on press, exposes accessibility
 * role="switch" + state, and announces the state change. Use it for
 * the per-partner switch, the per-entry Shared switch, and the global
 * default — never build a second toggle.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

export interface SharedSwitchProps {
  /** Current on/off state. */
  value: boolean;
  /** Called with the flipped value. */
  onChange: (next: boolean) => void;
  /** Accessibility label, e.g. "Sharing for Maya". */
  accessibilityLabel: string;
  /** Optional testID for interaction tests. */
  testID?: string;
  /** When true the switch renders dimmed and ignores presses. */
  disabled?: boolean;
  /**
   * Compact rendering for feed cards (Anuraj, Sept 2026): the track is
   * visually smaller (44x26, 22px knob) but hitSlop={10} keeps the
   * effective tap target at ~64x46 — small enough to be visually
   * light, still easy to toggle. Coral ON / gray OFF, role="switch"
   * and all toggle semantics are unchanged. Default is the full
   * 51x31 treatment (partners card, global default).
   */
  compact?: boolean;
}

export default function SharedSwitch({
  value,
  onChange,
  accessibilityLabel,
  testID,
  disabled,
  compact,
}: SharedSwitchProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        if (!disabled) onChange(!value);
      }}
      disabled={disabled}
      hitSlop={compact ? 10 : 0}
      style={[
        styles.sw,
        compact && styles.swCompact,
        disabled && styles.swDisabled,
      ]}
    >
      <View
        style={[
          styles.track,
          compact && styles.trackCompact,
          value && styles.trackOn,
        ]}
      >
        <View
          style={[
            styles.knob,
            compact && styles.knobCompact,
            value ? styles.knobOn : styles.knobOff,
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt hit area, transparent — the mockup's `.sw`.
  sw: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  swDisabled: {
    opacity: 0.5,
  },
  // Compact mode: the button hugs the 44x26 track (transparent);
  // hitSlop={10} expands the effective target to ~64x46.
  swCompact: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // 51x31 track, radius 16 — the mockup's `.sw-track`.
  track: {
    width: 51,
    height: 31,
    borderRadius: 16,
    backgroundColor: '#D9D2C4',
    justifyContent: 'center',
    // inner shadow on the OFF track (mockup: inset 0 1px 3px rgba(0,0,0,.12))
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 0,
  },
  // 44x26 compact track (compact mode).
  trackCompact: {
    width: 44,
    height: 26,
    borderRadius: 13,
  },
  // coral ON track (mockup: #E8927C).
  trackOn: {
    backgroundColor: '#E8927C',
    shadowOpacity: 0,
  },
  // 27x27 knob — the mockup's `.sw-knob`.
  knob: {
    position: 'absolute',
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    top: 2,
    // mockup: 0 2px 6px rgba(0,0,0,.22)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 2,
  },
  knobOff: { left: 2 },
  knobOn: { right: 2 },
  // 22x22 compact knob — 2px inset inside the 44x26 track.
  knobCompact: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
});
