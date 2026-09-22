/**
 * Partner onboarding popup-flow regression (Anuraj's five points, Sept 2026,
 * mockup 33-partner-welcome.html rev — approved by Anuraj Sept 21, 2026):
 *
 *  1. "Add a partner" opens ONE popup (the shared BottomSheet) with a name
 *     field ("Who is this code for?") + "Create code" (quiet until a name is
 *     typed). "Create code" swaps the popup to show JUST the 6-char code
 *     with Copy — nothing else. The popup dismisses via its × (the sheet
 *     also supports tap-outside / pull-down). The old inline name-then-code
 *     reveal inside the card is gone, as is the old new-code reveal card.
 *  2. After dismissal the partner appears in the "Your partners" list with
 *     "Add a partner" below the list. Row rules: pending = name +
 *     "· Invited" + code + Copy + ×; accepted = name + sharing switch + ×
 *     (code hidden). Every × asks for confirmation first (RemoveConfirmDialog).
 *  3. The duplicate "Invite the people you want following along…" line is
 *     gone from inside the card (it stays at the top of the screen).
 *  4. No Continue on the onboarding share screen (step 2 keeps a quiet
 *     ghost skip so the wizard still advances).
 *  5. Joiner-side name field (CodeEntryScreen): the helper says plainly to
 *     use the SAME name the partner used when creating the invite.
 *
 * Components are invoked directly with stubbed React hooks (the repo's
 * established pattern: function components are NOT rendered, the JSX
 * tree is walked). Stateful phases are reached by invoking the extracted
 * presentational components (AddPartnerPopup, PartnersListCard) directly.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/partner_popup_flow.test.ts src/partner/ShareCodeScreen.tsx \
 *     src/partner/CodeEntryScreen.tsx src/components/BottomSheet.tsx src/components/Button.tsx \
 *     src/components/SharedSwitch.tsx src/components/KeyboardAvoid.tsx \
 *     src/partner/RemoveConfirmDialog.tsx src/partner/inviteCodes.ts src/theme/tokens.ts \
 *     --outDir /tmp/nurture-popup-tests --module commonjs --target es2022 \
 *     --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-popup-tests/tests/partner_popup_flow.test.js
 */

const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

/* --- React hook stubs: top-level hooks run during direct invocation --- */
const noop = () => {};
/**
 * useState call order inside ShareCodeScreen (documented here — the 5/5
 * test below overrides the FIRST call, `invites`, via this queue):
 * invites, server, creating, revokingId, togglingId, confirming,
 * popupOpen, popupName, popupPhase, popupCode.
 */
let useStateQueue: unknown[] = [];
const reactStub: Record<string, unknown> = {
  useState: (init: unknown) => [
    useStateQueue.length > 0
      ? useStateQueue.shift()
      : typeof init === 'function'
        ? (init as () => unknown)()
        : init,
    noop,
  ],
  useEffect: noop,
  useRef: (init: unknown) => ({ current: init }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useReducer: (reducer: unknown, init: unknown) => [init, noop],
  Fragment: 'Fragment',
  createElement: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
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
  // CodeEntryScreen's db + partner-name persistence never run during render.
  if (request === '../lib/db' || request === './partnerHome') {
    return { kvGet: noop, kvSet: noop, setPartnerNames: noop };
  }
  return origLoad.call(this, request, ...rest);
};

declare const process: { exit(code: number): void; cwd(): string };
declare const require: any;

import { default as BottomSheet } from '../src/components/BottomSheet';
import { default as Button } from '../src/components/Button';
import { default as SharedSwitch } from '../src/components/SharedSwitch';
import {
  AddPartnerPopup,
  PartnersListCard,
  default as ShareCodeScreen,
} from '../src/partner/ShareCodeScreen';
import { default as CodeEntryScreen } from '../src/partner/CodeEntryScreen';

type El = { type?: unknown; props?: Record<string, unknown> };

/** Depth-first walk of the returned JSX tree (function components are NOT invoked). */
function walk(el: unknown, visit: (e: El) => void): void {
  if (Array.isArray(el)) {
    for (const k of el) walk(k, visit);
    return;
  }
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

function findAllTestIDs(root: unknown, prefix: string): El[] {
  const out: El[] = [];
  walk(root, (e) => {
    if (typeof e.props?.testID === 'string' && (e.props.testID as string).startsWith(prefix)) {
      out.push(e);
    }
  });
  return out;
}

/** Every string under a subtree, concatenated (handles nested <Text> bold spans). */
function allText(root: unknown): string {
  let out = '';
  const rec = (el: unknown): void => {
    if (typeof el === 'string') {
      out += el;
      return;
    }
    if (Array.isArray(el)) {
      for (const k of el) rec(k);
      return;
    }
    if (!el || typeof el !== 'object') return;
    rec((el as El).props?.children);
  };
  rec(root);
  return out;
}

/** allText with JSX whitespace (newlines/indentation) collapsed. */
function flatText(root: unknown): string {
  return allText(root).replace(/\s+/g, ' ');
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
const src = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const noopCb = () => {};

/* --- 1. The add flow lives in ONE popup (shared BottomSheet) ------------- */
// First useState call in ShareCodeScreen is `invites`: render the empty list.
useStateQueue = [[]];
const screen = ShareCodeScreen({ onToast: noopCb }) as unknown as El;
useStateQueue = [];
const popupSheet = findTestID(screen, 'partner-add-sheet');
check('add flow uses the shared BottomSheet popup', popupSheet !== null && popupSheet.type === BottomSheet);
check('popup starts closed', popupSheet !== null && popupSheet.props?.visible === false);
check('"Add a partner" button is present below the list', findTestID(screen, 'partners-list-add') !== null);

/* --- 2. Old inline flow is gone ------------------------------------------ */
check('no inline name-then-code add box inside the card', findTestID(screen, 'partner-add') === null);
check('no new-code reveal card', findTestID(screen, 'partner-new-code') === null);
check(
  'no lingering showListCard prop (onboarding shows the same card)',
  !src('src/partner/ShareCodeScreen.tsx').includes('showListCard'),
);

/* --- 3. Popup name phase -------------------------------------------------- */
const namePhase = AddPartnerPopup({
  phase: 'name',
  name: '',
  code: null,
  creating: false,
  onNameChange: noopCb,
  onCreate: noopCb,
  onCopy: noopCb,
  onClose: noopCb,
}) as unknown as El;
const nameField = findTestID(namePhase, 'partner-popup-name');
check('popup name phase has the partner-name field', nameField !== null && nameField.type === 'TextInput');
check(
  'name field placeholder is "Partner\'s name"',
  nameField !== null && nameField.props?.placeholder === "Partner's name",
);
check('name phase asks "Who is this code for?"', flatText(namePhase).includes('Who is this code for?'));
const createBtn = findTestID(namePhase, 'partner-popup-create');
check('name phase has a "Create code" button', createBtn !== null && createBtn.type === Button);
check(
  '"Create code" is quiet (disabled) until a name is typed',
  createBtn !== null && createBtn.props?.disabled === true,
);
const createBtnNamed = AddPartnerPopup({
  phase: 'name',
  name: 'Sam',
  code: null,
  creating: false,
  onNameChange: noopCb,
  onCreate: noopCb,
  onCopy: noopCb,
  onClose: noopCb,
}) as unknown as El;
const createBtnEnabled = findTestID(createBtnNamed, 'partner-popup-create');
check(
  '"Create code" enables once a name is typed',
  createBtnEnabled !== null && createBtnEnabled.props?.disabled === false,
);
check('popup has its own × dismiss', findTestID(namePhase, 'partner-popup-close') !== null);

/* --- 4. Popup code phase: JUST the code + Copy ---------------------------- */
const codePhase = AddPartnerPopup({
  phase: 'code',
  name: '',
  code: 'K7X2QM',
  creating: false,
  onNameChange: noopCb,
  onCreate: noopCb,
  onCopy: noopCb,
  onClose: noopCb,
}) as unknown as El;
const codeText = findTestID(codePhase, 'partner-popup-code');
check('code phase shows the 6-char code', codeText !== null && codeText.props?.children === 'K7X2QM');
check('code phase has a Copy button', findTestID(codePhase, 'partner-popup-copy') !== null);
check('code phase shows no name field', findTestID(codePhase, 'partner-popup-name') === null);
check('code phase shows no "Create code" button', findTestID(codePhase, 'partner-popup-create') === null);
check('code phase keeps the × dismiss', findTestID(codePhase, 'partner-popup-close') !== null);

/* --- 5. List card: empty state has no duplicate explainer ----------------- */
const emptyCard = PartnersListCard({
  invites: [],
  server: 'ok',
  revokingId: null,
  togglingId: null,
  onRemove: noopCb,
  onCopyCode: noopCb,
  onToggle: noopCb,
}) as unknown as El;
check(
  'empty card drops the duplicate "Invite the people you want following along" line',
  !flatText(emptyCard).includes('Invite the people you want following along'),
);
check('empty card still shows the header + counter', flatText(emptyCard).includes('Your partners'));

/* --- 6. Row rules ---------------------------------------------------------- */
const pending = {
  id: 'p1',
  name: 'Sam',
  code: 'K7X2QM',
  status: 'pending' as const,
  sharingEnabled: true,
};
const accepted = {
  id: 'a1',
  name: 'Jo',
  code: undefined,
  status: 'accepted' as const,
  sharingEnabled: true,
};
const mixedCard = PartnersListCard({
  invites: [pending, accepted],
  server: 'ok',
  revokingId: null,
  togglingId: null,
  onRemove: noopCb,
  onCopyCode: noopCb,
  onToggle: noopCb,
}) as unknown as El;
const pendingRow = findTestID(mixedCard, 'partner-row-p1');
check(
  'pending row shows "Name · Invited"',
  pendingRow !== null && flatText(pendingRow).includes('Sam') && flatText(pendingRow).includes('· Invited'),
);
check('pending row shows the code + Copy', findTestID(mixedCard, 'partner-row-code-p1') !== null && findTestID(mixedCard, 'partner-row-copy-p1') !== null);
check('pending row has a ×', findTestID(mixedCard, 'partner-row-remove-p1') !== null);
const acceptedRow = findTestID(mixedCard, 'partner-row-a1');
const acceptedSwitch = findTestID(mixedCard, 'partner-row-switch-a1');
check('accepted row shows the name', acceptedRow !== null && flatText(acceptedRow).includes('Jo'));
check('accepted row shows the sharing switch', acceptedSwitch !== null && acceptedSwitch.type === SharedSwitch);
check('accepted row has a ×', findTestID(mixedCard, 'partner-row-remove-a1') !== null);
check('accepted row hides the code', findTestID(mixedCard, 'partner-row-code-a1') === null && findTestID(mixedCard, 'partner-row-copy-a1') === null);

/* --- 7. Five-of-5: warm note replaces the add option ---------------------- */
const five = [0, 1, 2, 3, 4].map((i) => ({
  id: `m${i}`,
  name: `P${i}`,
  code: i < 2 ? 'ABCDEF' : undefined,
  status: (i < 2 ? 'pending' : 'accepted') as 'pending' | 'accepted',
  sharingEnabled: true,
}));
useStateQueue = [five]; // first useState call in ShareCodeScreen is `invites`
const fullScreen = ShareCodeScreen({ onToast: noopCb }) as unknown as El;
useStateQueue = [];
check(
  'at 5/5 the warm max note replaces "Add a partner"',
  findTestID(fullScreen, 'partners-list-max') !== null &&
    flatText(fullScreen).includes("You've added 5 partners — the most Willow allows right now."),
);
check('at 5/5 there is no "Add a partner" button', findTestID(fullScreen, 'partners-list-add') === null);

/* --- 8. Continue button on the onboarding share screen (Anuraj, Sept 21) -- */
/* The ghost "Skip for now" was replaced by a real secondary Continue button. */
const onboardingSrc = src('app/onboarding.tsx');
check('onboarding share step has a Continue button', onboardingSrc.includes('onboarding-share-continue'));
check(
  'Continue button advances the wizard past the share step',
  /title="Continue"[\s\S]*?onPress=\{\(\) => setStep\(3\)\}[\s\S]*?testID="onboarding-share-continue"/.test(onboardingSrc),
);
check(
  'ghost "Skip for now" button is gone',
  !onboardingSrc.includes('onboarding-share-skip') && !onboardingSrc.includes('title="Skip for now"'),
);
check(
  'onboarding renders the same partners card (no separate inline composer)',
  !onboardingSrc.includes('showListCard={false}'),
);

/* --- 9. Joiner-side name field: unmistakable name-matching copy ------------ */
const codeEntry = CodeEntryScreen({ onBack: noopCb, onVerified: noopCb }) as unknown as El;
const nameHint = findTestID(codeEntry, 'code-entry-name-hint');
check('code entry has the name-matching helper', nameHint !== null);
check(
  'helper says to use the same name the partner used (verbatim)',
  nameHint !== null &&
    flatText(nameHint).includes('same name') &&
    flatText(nameHint).includes('it has to match exactly'),
);
const joinerNameField = findTestID(codeEntry, 'code-entry-name');
check(
  'name field placeholder is just "e.g. Sam"',
  joinerNameField !== null && joinerNameField.props?.placeholder === 'e.g. Sam',
);
check(
  'vague "The name on your invite" placeholder is gone',
  !src('src/partner/CodeEntryScreen.tsx').includes('The name on your invite'),
);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nall partner popup-flow checks passed');
}
