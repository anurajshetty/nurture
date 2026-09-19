# Willow

Warm pregnancy journal + timeline (Expo, iOS-first). Web testing build deploys to GitHub Pages.

## Versioning

Willow uses `major.minor` (e.g. `1.0`, `1.1`, `2.0`) — no patch component.

- **Major** — major improvements
- **Minor** — important changes and bug fixes

The marketing version lives in `app.json` (`expo.version`). The iOS build number
(`expo.ios.buildNumber`) is separate: it starts at `1` and Apple requires it to
increment on every TestFlight/App Store upload. The `production` profile in `eas.json`
sets `autoIncrement: true`, so EAS bumps the build number automatically on each
production build — do not bump it by hand.

## Release checklist

Before every release build:

- `npx tsc --noEmit` clean; `bash tests/run_unit.sh` all green
- `npx expo export --platform ios` green; web export + boot test under `/willow/`
- **Bump `BRIEFING_CACHE_KEY` (`src/briefing/cache.ts`) whenever briefing
  copy or its tokens change** — a stale cached briefing is served all day
  when the device-local day + pregnancy week still match, so pre-change copy
  (e.g. a hardcoded name) would keep showing until the key suffix moves
- Push via `nurture-api-push.py`, verify the branch ref moved; deploy
  `gh-pages` and verify the live bundle is byte-identical to the tested build
