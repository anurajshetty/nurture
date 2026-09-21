/**
 * Week-tab pill-dock regression guard (src/week/pillDock.ts) — pure,
 * no native modules, no network.
 *
 * Round 1 (Anuraj caught it on his iPhone, Sept 20, 2026): the
 * reserved `week-pill-dock` below the Week scroll content rendered a
 * solid colors.bg block behind the floating Ask/Kicks pills.
 *
 * Round 2 (Anuraj caught it on web, Sept 20, 2026 — AFTER the
 * transparent fix shipped): the dock was correctly transparent, but it
 * sits OUTSIDE the Screen scroll container, directly on the tab screen
 * root, whose platform default on web is light gray (#f2f2f2). So the
 * transparent dock revealed a visible GRAY band behind the pills.
 * "Transparent" alone was the loophole.
 *
 * Corrected rule under test (two parts):
 *   1. the dock itself stays transparent — any solid fill fails; AND
 *   2. the Week screen root BEHIND the dock carries the page cream
 *      (#FAF6F0, colors.bg) — opaque, so the dock area is
 *      cream-indistinguishable from the page.
 * The reserved heights are product-validated and must not drift.
 *
 * Rule: layout containers added to fix overlap issues must not
 * introduce a visible fill OR reveal a non-cream parent.
 *
 * Run with:
 *   npx tsc tests/week_pill_dock.test.ts src/week/pillDock.ts src/theme/tokens.ts \
 *     --outDir /tmp/nurture-tests-pilldock --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-pilldock/tests/week_pill_dock.test.js
 */

import {
  PILL_DOCK_BACKGROUND,
  PILL_DOCK_PARENT_BACKGROUND,
  pillDockHeight,
} from '../src/week/pillDock';
import { colors } from '../src/theme/tokens';

declare const process: { exit(code: number): void };

let passed = 0;
function check(cond: boolean, name: string): void {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok: ${name}`);
}

// Part 1 — the dock itself: background must be transparent (or unset).
// Any solid fill — colors.bg included — fails.
const bg: string | undefined = PILL_DOCK_BACKGROUND as string | undefined;
check(
  bg === 'transparent' || bg === undefined,
  `dock background is transparent (got ${JSON.stringify(bg)})`,
);
check(
  typeof bg !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bg),
  'dock background is not a solid hex fill',
);

// Part 2 — the screen root behind the dock: must be the page cream,
// OPAQUE. A transparent/missing parent re-opens the gray-band loophole
// (web tab slot default is light gray #f2f2f2).
const parentBg: string = PILL_DOCK_PARENT_BACKGROUND as string;
check(
  parentBg === '#FAF6F0',
  `dock parent background is page cream (got ${JSON.stringify(parentBg)})`,
);
check(
  parentBg === colors.bg,
  'dock parent background matches the colors.bg token',
);
check(
  /^#([0-9a-fA-F]{6})$/.test(parentBg),
  'dock parent background is an opaque hex fill, not transparent',
);

// The reserved spacing is product-validated: 160pt fits both pills,
// 96pt fits the Ask pill alone. Heights must not drift.
check(pillDockHeight(true) === 160, 'dock reserves 160pt when kicks pill shows');
check(pillDockHeight(false) === 96, 'dock reserves 96pt for the Ask pill alone');

console.log(`PASS week_pill_dock (${passed} checks)`);
