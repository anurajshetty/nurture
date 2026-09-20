/**
 * KeyboardAvoid — the repo's shared iOS keyboard-avoidance wrapper
 * (Willow standard, Sept 20, 2026).
 *
 * Every text-entry surface in the app keeps the focused input visible
 * above the iOS keyboard through this ONE component — never ad-hoc
 * per-screen KeyboardAvoidingViews (Anuraj caught the log composer AND
 * the appointment sheet buried under the keyboard in the same
 * TestFlight session and directed a proper fix everywhere).
 *
 * Platform behavior:
 * - iOS:     behavior="padding" — the standard recommendation for
 *            forms. Adds bottom padding equal to the keyboard overlap
 *            so the focused field lifts into view.
 * - Android: no behavior — the app relies on the native
 *            android:windowSoftInputMode="adjustResize"; a JS shift on
 *            top would double-shift the layout.
 * - Web:     inert — the browser handles scrolling; style/children pass
 *            straight through.
 *
 * Where it lives:
 * - `Screen` wraps its content with it by default (`keyboardAvoid`
 *   prop, default true) — covers onboarding, auth, you, export, and
 *   the week tab (including the care-team question input).
 * - `BottomSheet` wraps its fill with it internally — every sheet text
 *   field (appointment sheet/editor, journal sheet) gets it free.
 *   Sheets without text inputs never summon the keyboard, so it is a
 *   no-op there.
 * - `FloatingComposer` wraps its floating card with it (the Logs tab
 *   opts OUT of Screen's wrapper: `keyboardAvoid={false}`, to avoid a
 *   double shift).
 * - `AskChat` uses it for the footer composer.
 *
 * Future screens: if your screen has a TextInput, it is covered —
 * render inside `Screen` (or a `BottomSheet`) and do nothing. Only opt
 * out (`keyboardAvoid={false}`) when the surface manages its own
 * avoidance (like FloatingComposer) or has no text input at all and
 * the extra wrapper is noise. An explicit `behavior` prop overrides
 * the platform default when a surface genuinely needs it.
 */
import type { ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type KeyboardAvoidingViewProps,
} from 'react-native';

export function KeyboardAvoid(props: KeyboardAvoidingViewProps): ReactElement {
  const { behavior, ...rest } = props;
  return (
    <KeyboardAvoidingView
      behavior={behavior ?? (Platform.OS === 'ios' ? 'padding' : undefined)}
      {...rest}
    />
  );
}
