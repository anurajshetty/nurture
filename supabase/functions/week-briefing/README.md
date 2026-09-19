# week-briefing — Supabase Edge Function

Generates the anonymous pregnancy-week briefing cards via the Gemini API.
The API key lives **only here** as an Edge Function secret — it is never
in the app, never in git, never in a response.

## Files

- `index.ts` — Deno entry: env, CORS, HTTP status mapping.
- `lib.ts` — validation, prompt engineering, Gemini call, response
  validation. Deno-free on purpose so it unit-tests under node
  (`tests/week_briefing.test.ts`).

## Secret setup (Anuraj's step)

Secret name: **`GEMINI_API_KEY`**

1. Open the Supabase dashboard → the **nurture** project.
2. Go to **Edge Functions** → **Secrets** (or Project Settings → Edge Functions → Manage secrets).
3. Add secret: name `GEMINI_API_KEY`, value = your Gemini API key.
4. Save. No redeploy needed for secret changes.

Until the secret is set, the function answers every call with
HTTP 503 `{ "error": "not_configured" }` — the app treats this as
"briefings unavailable" and degrades gracefully (it never shows an error
card to her).

## Deploy

From the repo root, with the Supabase CLI installed and logged in:

```sh
supabase functions deploy week-briefing
```

(Do not deploy from CI or hand the key to anyone — only Anuraj holds it.)

## End-to-end verification

Live verification needs the secret set first (Anuraj's step above). After
deploy, in the Supabase dashboard → Edge Functions → `week-briefing` →
Invoke, POST:

```json
{
  "week": 28,
  "day": 3,
  "firstTimeMom": true,
  "ageBand": "30-34",
  "symptomThemes": ["backache", "insomnia"]
}
```

Expected: HTTP 200 with `{ cards: [baby, body, know, tips], reviewDate, footer }`.

## Contract (for the app's refresh logic)

Invoke: `supabase.functions.invoke('week-briefing', { body })`

Request — strict schema, **no other fields accepted** (extra fields → 400):

| field          | type                                    | required |
|----------------|-----------------------------------------|----------|
| `week`         | int, 4–42                               | yes      |
| `day`          | int, 1–7 (day of the gestational week)  | yes      |
| `firstTimeMom` | boolean                                 | yes      |
| `ageBand`      | `under-25` \| `25-29` \| `30-34` \| `35-39` \| `40-plus` | no |
| `symptomThemes`| string[], 0–5 items                     | yes      |

Responses:

| status | body | meaning |
|--------|------|---------|
| 200 | `{ cards: [{id,title,subtitle,body}×4], reviewDate: "YYYY-MM-DD", footer: "…" }` | briefing ready; cards are exactly `baby → body → know → tips` |
| 400 | `{ error: "invalid_request" }` or `{ error: "invalid_json" }` | bad schema — fix the caller, don't retry blindly |
| 405 | `{ error: "method_not_allowed" }` | non-POST |
| 502 | `{ error: "provider_error" }` | Gemini failed — safe to retry later with backoff |
| 503 | `{ error: "not_configured" }` | secret missing — stay silent in the UI, retry another day |

`reviewDate` is always the function's today (UTC); `footer` is a fixed
string: "Not medical advice — general information only."

## Privacy guarantees (do not regress)

- Request schema rejects anything beyond the five anonymized fields.
- The function **never logs the request body** — not in success, validation,
  or error paths.
- The API key is read only from `Deno.env`; never returned, never logged.
- Provider internals (HTTP status, error bodies) are never returned to the
  caller and never logged — every provider failure is `{ error: "provider_error" }`.
- The Gemini prompt contains only the anonymized context; the system
  instruction enforces general-information-only language with hard bans on
  diagnosis, triage, personalization ("your X means Y"), fetal nicknames,
  and gendered assumptions.
