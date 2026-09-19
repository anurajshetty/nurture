-- Migration: add the onboarding profile fields to the pregnancies table.
--
-- Sept 2026 (onboarding worker B): the app's local schema v4 stores the
-- mother's first name and birthday on the pregnancy record
-- (src/lib/schema.ts — owner_name TEXT, dob TEXT as YYYY-MM-DD, same
-- calendar-date convention as due_date). These columns must exist on the
-- remote table or the sync upsert in src/sync/engine.ts will fail.
--
-- Both are PII. They travel the same owner-only RLS path as the rest of
-- the pregnancy record and are explicitly excluded from the briefing edge
-- function payload (see src/briefing/context.ts). Before this ships to the
-- App Store, add both fields to the privacy disclosures.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the
-- dashboard SQL editor. IF NOT EXISTS keeps it safe to re-run.

ALTER TABLE pregnancies ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE pregnancies ADD COLUMN IF NOT EXISTS dob TEXT;
