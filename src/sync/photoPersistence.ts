/**
 * Photo-persistence kill switch (Anuraj, Sept 2026 — TEMPORARY, storage
 * constraint).
 *
 * `false` = photo persistence OFF app-wide. No photo bytes are uploaded
 * to Supabase Storage, copied into the app sandbox, or queued for retry —
 * for log entries AND reports. The composer still lets her attach photos
 * (the affordance stays); attachment metadata (kind/name) is kept on the
 * event, but the image data is never written to disk or sent anywhere.
 * Feed entries render a warm picture placeholder instead of the photo,
 * and no "Backing up…" state is ever shown.
 *
 * Text/data sync is completely unaffected by this flag.
 *
 * TO RE-ENABLE: set this to `true`, restore the upload bodies of
 * `enqueueMediaUploads` / `drainMediaOutbox` in src/sync/media.ts (the
 * originals were removed Sept 2026 — see git history of that file), then
 * re-verify the media-outbox drain in src/sync/SyncContext.tsx and the
 * composer save paths.
 */
export const PHOTOS_PERSIST_ENABLED = false;
