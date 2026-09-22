/**
 * New-log composer + appointment sheet regression (Anuraj caught live on
 * his iPhone, Sept 2026):
 *
 *  1. The new-log sheet's save button is labeled exactly "Save" (was
 *     "Save log") and the sheet uses the shared BottomSheet — grabber
 *     pill + pull-down-to-dismiss + safe-area bottom padding — with NO
 *     × close button. The old custom overlay (clipped Save button under
 *     the tab bar) is gone.
 *  2. The appointment sheet's content scrolls inside the shared
 *     BottomSheet (keyboardShouldPersistTaps="handled") so with the
 *     keyboard up the header stays fully visible, fields scroll, and
 *     "Save appointment" stays reachable above the keyboard.
 *
 * Components are invoked directly with stubbed React hooks (the repo's
 * established pattern: function components are NOT rendered, the JSX
 * tree is walked).
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/new_log_sheet.test.ts --outDir /tmp/nurture-newlog-tests \
 *     --module commonjs --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-newlog-tests/tests/new_log_sheet.test.js
 */

const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

/* --- React hook stubs: top-level hooks run during direct invocation --- */
const noop = () => {};
const reactStub: Record<string, unknown> = {
  useState: (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    noop,
  ],
  useEffect: noop,
  useRef: (init: unknown) => ({ current: init }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useReducer: (reducer: unknown, init: unknown) => [init, noop],
  Fragment: 'Fragment',
};
reactStub.default = reactStub;

const jsxFactory = (type: unknown, props: Record<string, unknown>) => ({ type, props });

const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'react') return reactStub;
  if (request === 'react/jsx-runtime')
    return { jsx: jsxFactory, jsxs: jsxFactory, Fragment: 'Fragment' };
  if (request === 'react-native') {
    return {
      ScrollView: 'ScrollView',
      Pressable: 'Pressable',
      Text: 'Text',
      TextInput: 'TextInput',
      View: 'View',
      Modal: 'Modal',
      Animated: { Value: function () {}, View: 'Animated.View', timing: () => ({ start: noop }), spring: () => ({ start: noop }), parallel: () => ({ start: noop }) },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      Dimensions: { get: () => ({ height: 800, width: 390 }) },
      StyleSheet: {
        create: (s: unknown) => s,
        absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
      },
      Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
    };
  }
  if (request === 'react-native-safe-area-context') {
    return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
  }
  if (request === 'expo-router') {
    return { useRouter: () => ({ push: noop }) };
  }
  if (request === '@react-native-community/datetimepicker') {
    return { default: 'DateTimePicker' };
  }
  if (request === 'expo-sqlite') return { openDatabaseSync: () => null };
  if (request === 'expo-crypto') return { digestStringAsync: async () => 'x' };
  return origLoad.call(this, request, ...rest);
};

declare const process: { exit(code: number): void; cwd(): string };
declare const require: any;

import { default as BottomSheet } from '../src/components/BottomSheet';
import { default as NewLogForm } from '../src/logs/NewLogForm';
import { default as AppointmentSheet } from '../src/logs/AppointmentSheet';

type El = { type?: unknown; props?: Record<string, unknown> };

/** Depth-first walk of the returned JSX tree (function components are NOT invoked). */
function walk(el: unknown, visit: (e: El) => void): void {
  if (!el || typeof el !== 'object') return;
  const e = el as El;
  visit(e);
  const kids = (e.props?.children ?? []) as unknown;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) walk(k, visit);
}

function findTestID(root: unknown, testID: string): El | null {
  let found: El | null = null;
  walk(root, (e) => {
    if (!found && e.props?.testID === testID) found = e;
  });
  return found;
}

/** All string children of every Text node in the tree. */
function textStrings(root: unknown): string[] {
  const out: string[] = [];
  walk(root, (e) => {
    if (e.type === 'Text' && typeof e.props?.children === 'string') {
      out.push(e.props.children as string);
    }
  });
  return out;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    console.log(`FAIL - ${name}${detail === undefined ? '' : ' :: ' + String(detail).slice(0, 200)}`);
    failures++;
  }
}

const fs = require('fs');
const path = require('path');
const src = (p: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8');

/* --- 1. NewLogForm renders inside the shared BottomSheet --------------- */
const form = NewLogForm({ onSaved: noop, onClose: noop }) as unknown as El;
check('new-log sheet root is the shared BottomSheet', form.type === BottomSheet);
check('new-log sheet keeps its overlay testID', form.props?.testID === 'new-log-overlay');

/* --- 2. Save button labeled exactly "Save" ------------------------------ */
{
  const save = findTestID(form, 'new-log-save');
  check('new-log save button exists', !!save && save.type === 'Pressable');
  if (save) {
    const label = textStrings(save)[0];
    check('save button label is exactly "Save"', label === 'Save', label);
    check('save button accessibilityLabel is "Save"', save.props?.accessibilityLabel === 'Save');
  }
  const all = textStrings(form).join('\n');
  check('no "Save log" string anywhere in the sheet', !/Save log/.test(all));
}

/* --- 3. No × close button ---------------------------------------------- */
{
  check('no new-log-close testID', !findTestID(form, 'new-log-close'));
  const glyphs = textStrings(form);
  check('no × glyph anywhere in the sheet', !glyphs.includes('×'), glyphs.join(' | ').slice(0, 200));
}

/* --- 4. Content scrolls inside the sheet -------------------------------- */
{
  const scroll = findTestID(form, 'new-log-scroll');
  check('new-log content is a ScrollView', !!scroll && scroll.type === 'ScrollView');
  if (scroll) {
    check(
      'new-log ScrollView keeps taps while keyboard is up',
      scroll.props?.keyboardShouldPersistTaps === 'handled',
    );
    check(
      'save button lives inside the scrollable content',
      !!findTestID(scroll, 'new-log-save'),
    );
  }
}

/* --- 5. NewLogForm source: shared sheet, no custom overlay -------------- */
{
  const f = src('logs/NewLogForm.tsx');
  check('NewLogForm imports the shared BottomSheet', /from '\.\.\/components\/BottomSheet'/.test(f));
  check('NewLogForm has no custom overlay style', !/styles\.overlay/.test(f));
  check('NewLogForm has no scrim of its own', !/new-log-scrim/.test(f));
  check('NewLogForm source has no × close markup', !/new-log-close/.test(f));
  check('NewLogForm source has no "Save log" copy', !/Save log/.test(f));
}

/* --- 6. BottomSheet source: grabber + drag-dismiss + safe area ---------- */
{
  const b = src('components/BottomSheet.tsx');
  check('BottomSheet renders a grabber pill', /styles\.grab\b/.test(b) && /grabZone/.test(b));
  check('BottomSheet supports pull-down-to-dismiss', /PanResponder/.test(b) && /DISMISS_DISTANCE/.test(b));
  check('BottomSheet pads the sheet above the safe area', /insets\.bottom/.test(b));
  check('BottomSheet keeps fields visible via the shared KeyboardAvoid', /KeyboardAvoid/.test(b));
}

/* --- 7. AppointmentSheet: scrollable content, Save appointment intact --- */
{
  const sheet = AppointmentSheet({ visible: true, onClose: noop, onSaved: noop }) as unknown as El;
  check('appointment sheet root is the shared BottomSheet', sheet.type === BottomSheet);
  const scroll = findTestID(sheet, 'appointment-sheet-scroll');
  check('appointment content is a ScrollView', !!scroll && scroll.type === 'ScrollView');
  if (scroll) {
    check(
      'appointment ScrollView keeps taps while keyboard is up',
      scroll.props?.keyboardShouldPersistTaps === 'handled',
    );
    check('header label is inside the scrollable content', textStrings(scroll).includes('With whom / where'));
    const save = findTestID(scroll, 'appointment-save');
    check('Save appointment button is inside the scrollable content', !!save);
    if (save) {
      check('button label stays "Save appointment"', textStrings(save)[0] === 'Save appointment');
    }
  }
  const a = src('logs/AppointmentSheet.tsx');
  check('AppointmentSheet imports ScrollView', /ScrollView/.test(a));
  check('AppointmentSheet keeps the "Save appointment" label', />Save appointment</.test(a));
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log('\nAll new-log sheet checks passed.');
}
