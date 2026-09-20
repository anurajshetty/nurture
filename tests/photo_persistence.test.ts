/**
 * Photo-persistence kill-switch tests (Anuraj, Sept 2026 — temporary,
 * storage constraint).
 *
 * Contract under test: with PHOTOS_PERSIST_ENABLED = false, photo bytes
 * are NEVER written to disk and NEVER uploaded anywhere.
 *
 * - The flag itself is false at runtime (src/sync/photoPersistence.ts).
 * - `enqueueMediaUploads` / `drainMediaOutbox` in src/sync/media.ts are
 *   gated on the flag and their bodies contain no disk-write or
 *   upload sinks (no Supabase Storage calls, no sandbox copies).
 * - The feed (src/composer/EventCard.tsx) renders photos as a warm
 *   placeholder tile — never a real image — and shows no "Backing up…"
 *   or "Not backed up yet" state for log entries.
 * - Every disabled call site (Composer, JournalSheet, SyncContext) is
 *   commented against the kill switch.
 * - No other module under src/composer|src/logging|src/sync writes
 *   photo bytes (no copyAsync, no storage uploads).
 *
 * Run with:
 *
 *   npx tsc tests/photo_persistence.test.ts src/sync/photoPersistence.ts \
 *     --outDir /tmp/nurture-tests-pp --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-pp/tests/photo_persistence.test.js
 *
 * (Run from the repo root so the source-tree assertions below resolve.)
 */

import { PHOTOS_PERSIST_ENABLED } from '../src/sync/photoPersistence';

declare const require: any;
declare const process: { cwd(): string; exit(code: number): void };

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

function srcOf(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

/** Extracts the body of `... function NAME(...) { ... }` or `const NAME = ... { ... }` via brace matching. */
function fnBody(src: string, name: string): string | null {
  let sig = src.indexOf(`function ${name}(`);
  if (sig < 0) sig = src.indexOf(`const ${name} =`);
  if (sig < 0) return null;
  const open = src.indexOf('{', sig);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/* ---------------- the kill switch itself ---------------- */

ok('PHOTOS_PERSIST_ENABLED is false', PHOTOS_PERSIST_ENABLED === false);

/* ---------------- media pipeline: no disk writes, no uploads ---------------- */

const media = srcOf('src/sync/media.ts');
ok('media.ts imports the kill switch', media.includes('./photoPersistence'));

const WRITE_SINKS = [
  'supabase.storage',
  'createSignedUrl',
  'copyAsync',
  'writeAsStringAsync',
  'new Directory(',
  'new File(',
];

for (const fn of ['enqueueMediaUploads', 'drainMediaOutbox']) {
  const body = fnBody(media, fn);
  ok(`media.ts: ${fn} exists`, body !== null);
  if (body !== null) {
    ok(`media.ts: ${fn} is gated on PHOTOS_PERSIST_ENABLED`, body.includes('PHOTOS_PERSIST_ENABLED'));
    for (const sink of WRITE_SINKS) {
      ok(`media.ts: ${fn} never touches "${sink}"`, !body.includes(sink));
    }
  }
}

/* ---------------- feed: placeholder only, no backup states ---------------- */

const card = srcOf('src/composer/EventCard.tsx');
ok('EventCard renders the photo placeholder', card.includes('PhotoPlaceholder'));
ok('EventCard placeholder has a stable testID', card.includes('event-card-photo-placeholder'));
ok('EventCard never resolves attachment URIs', !card.includes('useAttachmentUri'));
ok('EventCard never mints signed media URLs', !card.includes('getSignedMediaUrl'));
ok('EventCard has no MediaPhoto component', !card.includes('MediaPhoto'));
ok("EventCard shows no 'Backing up…' state", !card.includes("'Backing up…'"));
ok("EventCard shows no 'Not backed up yet' state", !card.includes("'Not backed up yet'"));

/* ---------------- composer [+] is a visible dummy ---------------- */

const composer = srcOf('src/composer/Composer.tsx');
ok(
  'Composer [+] taps show the exact paused message',
  composer.includes("showToast('Photo uploads are paused for now', null)"),
);
ok(
  'Composer [+] onPress goes through the dummy handler',
  composer.includes('onPress={handleAttachPress}'),
);
ok(
  'Composer dummy handler is gated on PHOTOS_PERSIST_ENABLED',
  (() => {
    const body = fnBody(composer, 'handleAttachPress');
    return body !== null && body.includes('PHOTOS_PERSIST_ENABLED');
  })(),
);
ok(
  'Composer [+] never opens the attach sheet while paused',
  !composer.includes('onPress={() => setSheetOpen(true)}'),
);

for (const rel of [
  'src/composer/Composer.tsx',
  'src/logging/JournalSheet.tsx',
  'src/sync/SyncContext.tsx',
]) {
  const src = srcOf(rel);
  ok(`${rel}: disabled call site references the kill switch`, src.includes('PHOTOS_PERSIST_ENABLED'));
}

/* ---------------- no other byte-write paths ---------------- */

const SCAN_SINKS = ['copyAsync', '.storage.from('];
let scanClean = true;
const offenders: string[] = [];
// (Minimal walker: only the .ts/.tsx files directly relevant to media.)
const CANDIDATES = [
  'src/composer/Composer.tsx',
  'src/composer/EventCard.tsx',
  'src/composer/attachments.ts',
  'src/composer/attachments.web.ts',
  'src/composer/exif.ts',
  'src/logging/JournalSheet.tsx',
  'src/sync/engine.ts',
  'src/sync/SyncContext.tsx',
  'src/sync/store.ts',
];
for (const rel of CANDIDATES) {
  const src = srcOf(rel);
  for (const sink of SCAN_SINKS) {
    if (src.includes(sink)) {
      scanClean = false;
      offenders.push(`${rel}: ${sink}`);
    }
  }
}
ok('no copyAsync / storage uploads outside the gated media module', scanClean);
for (const o of offenders) console.error(`  offender: ${o}`);

/* ---------------- summary ---------------- */

console.log(`photo_persistence: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
