#!/bin/bash
# Runs every tests/*.test.ts unit suite the way each file's header documents:
# compile with tsc to /tmp and run the emitted JS under node. No framework.
# Usage: bash tests/run_unit.sh
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
run() {
  local name="$1"; shift
  if "$@" > /tmp/nurture_unit_out.txt 2>&1; then
    echo "PASS $name"; pass=$((pass+1))
  else
    echo "FAIL $name"; tail -5 /tmp/nurture_unit_out.txt; fail=$((fail+1))
  fi
}
tsc1() { npx tsc --ignoreConfig "$@" --outDir "$OUT" --module commonjs --target es2022 --skipLibCheck --esModuleInterop; }

OUT=/tmp/nurture-briefing-tests
tsc1 tests/home_briefing.test.ts src/briefing/cache.ts src/briefing/policy.ts src/briefing/client.ts src/briefing/context.ts src/briefing/types.ts src/briefing/engine.ts src/briefing/matrix.ts src/briefing/delight.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts && run "home_briefing" node $OUT/tests/home_briefing.test.js

OUT=/tmp/nurture-v12-tests
tsc1 tests/v12_home_cards.test.ts src/briefing/v12cards.ts src/briefing/engine.ts src/briefing/policy.ts src/briefing/cache.ts src/briefing/client.ts src/briefing/matrix.ts src/briefing/delight.ts src/briefing/context.ts src/briefing/types.ts src/plan/questions.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts && run "v12_home_cards" env TZ=UTC node $OUT/tests/v12_home_cards.test.js

OUT=/tmp/nurture-matrix-tests
tsc1 tests/briefing_matrix.test.ts src/briefing/engine.ts src/briefing/matrix.ts src/briefing/delight.ts src/briefing/context.ts src/briefing/types.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts && run "briefing_matrix" node $OUT/tests/briefing_matrix.test.js

OUT=/tmp/nurture-tests-brief
tsc1 tests/briefing_context.test.ts src/briefing/context.ts src/onboarding/dates.ts src/lib/types.ts src/logging/symptoms.ts && run "briefing_context" env TZ=UTC node $OUT/tests/briefing_context.test.js

OUT=/tmp/nurture-tests-chat
tsc1 tests/pregnancy_chat.test.ts supabase/functions/pregnancy-chat/lib.ts && run "pregnancy_chat" node $OUT/tests/pregnancy_chat.test.js

OUT=/tmp/nurture-tests-wb
tsc1 tests/week_briefing.test.ts supabase/functions/week-briefing/lib.ts && run "week_briefing" node $OUT/tests/week_briefing.test.js

OUT=/tmp/nurture-tests-rs
tsc1 tests/report_summary.test.ts supabase/functions/report-summary/lib.ts && run "report_summary" node $OUT/tests/report_summary.test.js

OUT=/tmp/nurture-tests3
tsc1 tests/epic3_timeline.test.ts src/timeline/timeline.ts src/onboarding/dates.ts src/lib/types.ts && run "epic3_timeline" env TZ=UTC node $OUT/tests/epic3_timeline.test.js

OUT=/tmp/nurture-tests-wf
npx tsc --ignoreConfig tests/week_filter.test.ts src/timeline/timeline.ts src/onboarding/dates.ts src/lib/types.ts --outDir $OUT --module commonjs --target es2022 --skipLibCheck --esModuleInterop && run "week_filter" env TZ=UTC node $OUT/tests/week_filter.test.js

OUT=/tmp/nurture-tests-ws
npx tsc --ignoreConfig tests/week_logic_shared.test.ts src/onboarding/dates.ts src/timeline/timeline.ts src/week/content.ts src/briefing/context.ts src/briefing/matrix.ts src/briefing/delight.ts src/theme/tokens.ts src/lib/types.ts --outDir $OUT --module commonjs --target es2022 --skipLibCheck --esModuleInterop && run "week_logic_shared" env TZ=UTC node $OUT/tests/week_logic_shared.test.js

OUT=/tmp/nurture-tests-f
npx tsc --ignoreConfig tests/epic3_filters.test.ts src/timeline/TimelineFilters.tsx --outDir $OUT --module commonjs --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop && run "epic3_filters" env NODE_PATH="$PWD/node_modules" node $OUT/tests/epic3_filters.test.js

OUT=/tmp/nurture-lookback-tests
npx tsc --ignoreConfig tests/epic3_lookback.test.ts src/timeline/lookback.ts src/onboarding/dates.ts src/lib/types.ts --outDir $OUT --module commonjs --target es2022 --skipLibCheck --esModuleInterop && run "epic3_lookback" node $OUT/tests/epic3_lookback.test.js

OUT=/tmp/nurture-tests
tsc1 tests/epic2.test.ts src/composer/intent.ts src/composer/moodWindow.ts src/notifications/nudgeLogic.ts && run "epic2" node $OUT/tests/epic2.test.js

OUT=/tmp/nurture-tests23
tsc1 tests/epic2_3.test.ts src/composer/exif.ts src/sync/mediaShape.ts src/lib/types.ts && run "epic2_3" node $OUT/tests/epic2_3.test.js

OUT=/tmp/nurture-tests-457
tsc1 tests/epic4_5_4_7.test.ts src/composer/intent.ts src/onboarding/dates.ts src/lib/types.ts && run "epic4_5_4_7" env TZ=UTC node $OUT/tests/epic4_5_4_7.test.js

OUT=/tmp/nurture-tests24
npx tsc --ignoreConfig tests/epic2_4.test.ts src/composer/voice.ts --outDir $OUT --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop && run "epic2_4" node $OUT/tests/epic2_4.test.js

OUT=/tmp/nurture-tests44
# epic4_media suite removed Sept 19, 2026: the photo-backup flow it covered
# (src/logging/bumpPhotos.ts) was deleted when report/file uploads went
# ephemeral — feed entries are text-only now.

OUT=/tmp/nurture-delight-tests
tsc1 tests/delight.test.ts src/briefing/delight.ts src/theme/tokens.ts && run "delight" node $OUT/tests/delight.test.js

OUT=/tmp/nurture-babyname-tests
tsc1 tests/baby_name.test.ts src/briefing/context.ts src/briefing/delight.ts src/briefing/matrix.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts && run "baby_name" node $OUT/tests/baby_name.test.js

OUT=/tmp/nurture-tests-appt
tsc1 tests/week_appointments.test.ts src/week/appointments.ts && run "week_appointments" env TZ=America/Los_Angeles node $OUT/tests/week_appointments.test.js

OUT=/tmp/nurture-tests-week
tsc1 tests/week_content.test.ts src/week/content.ts src/briefing/matrix.ts src/briefing/delight.ts src/briefing/context.ts src/briefing/types.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts && run "week_content" node $OUT/tests/week_content.test.js

OUT=/tmp/nurture-tests-sizeart
tsc1 tests/size_art_rotation.test.ts src/week/sizeArt.ts && run "size_art_rotation" node $OUT/tests/size_art_rotation.test.js

OUT=/tmp/nurture-epic9-tests
tsc1 tests/epic9.test.ts src/support/aftermath.ts src/support/gentleReads.ts src/support/afterwardsCopy.ts src/lib/types.ts && run "epic9" node $OUT/tests/epic9.test.js

OUT=/tmp/nurture-onboarding-profile-tests
tsc1 tests/onboarding_profile.test.ts src/onboarding/dates.ts src/onboarding/shareInvite.ts src/lib/schema.ts && run "onboarding_profile" node $OUT/tests/onboarding_profile.test.js

OUT=/tmp/nurture-addmenu-tests
tsc1 tests/add_menu.test.ts src/logs/appointmentInput.ts src/lib/types.ts && run "add_menu" env TZ=UTC node $OUT/tests/add_menu.test.js
# reminder_timing suite retired Sept 20, 2026: the mockup-14 per-appointment
# timing editor was dropped entirely (Anuraj's call) — the 2-day default
# applies to all appointments; stored per-appointment overrides are ignored.
OUT=/tmp/nurture-rd-tests
npx tsc --ignoreConfig tests/reminder_default.test.ts --outDir $OUT --module commonjs --target es2022 --skipLibCheck --esModuleInterop && run "reminder_default" env TZ=UTC node $OUT/tests/reminder_default.test.js
OUT=/tmp/nurture-pp-tests
tsc1 tests/photo_persistence.test.ts src/sync/photoPersistence.ts && run "photo_persistence" node $OUT/tests/photo_persistence.test.js
OUT=/tmp/nurture-kicks-tests
npx tsc --ignoreConfig tests/kicks.test.ts --outDir $OUT --module commonjs --target es2022 --skipLibCheck --esModuleInterop && run "kicks" env TZ=UTC node $OUT/tests/kicks.test.js

echo "=== unit suites: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
