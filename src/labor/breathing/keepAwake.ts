/**
 * Back-compat re-export (Willow, Sept 2026).
 *
 * The wake lock now lives in the shared labor module
 * (`src/labor/keepAwake.ts`) so the contraction timer, breathing pacer, and
 * pelvic-floor session all use one implementation — Web Wake Lock API on web,
 * `expo-keep-awake` on native. Import from there directly in new code.
 */
export { requestScreenWakeLock } from '../keepAwake';
