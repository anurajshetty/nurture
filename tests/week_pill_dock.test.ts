/**
 * Week-tab pill-dock regression guard (src/week/pillDock.ts) — pure,
 * no native modules, no network.
 *
 * Anuraj caught it on his iPhone (Sept 20, 2026): the reserved
 * `week-pill-dock` below the Week scroll content rendered a solid
 * colors.bg block behind the floating Ask/Kicks pills. The dock exists
 * so the pills never cover body text — its reserved HEIGHT is the
 * product-validated behavior — but the container must never carry a
 * visible fill. The pills float over the page; the page cream shows
 * through.
 *
 * Rule under test: layout containers added to fix overlap issues must
 * not introduce a visible fill. If anyone sets PILL_DOCK_BACKGROUND to
 * a solid color (or changes the reserved heights), this suite fails.
 *
 * Run with:
 *   npx tsc tests/week_pill_dock.test.ts src/week/pillDock.ts \
 *     --outDir /tmp/nurture-tests-pilldock --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-pilldock/tests/week_pill_dock.test.js
 */

import { PILL_DOCK_BACKGROUND, pillDockHeight } from '../src/week/pillDock';

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

// The guard itself: background must be transparent (or unset). Any
// solid fill — colors.bg included — fails.
const bg: string | undefined = PILL_DOCK_BACKGROUND as string | undefined;
check(
  bg === 'transparent' || bg === undefined,
  `dock background is transparent (got ${JSON.stringify(bg)})`,
);
check(
  typeof bg !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bg),
  'dock background is not a solid hex fill',
);

// The reserved spacing is product-validated: 160pt fits both pills,
// 96pt fits the Ask pill alone. Heights must not drift.
check(pillDockHeight(true) === 160, 'dock reserves 160pt when kicks pill shows');
check(pillDockHeight(false) === 96, 'dock reserves 96pt for the Ask pill alone');

console.log(`PASS week_pill_dock (${passed} checks)`);
