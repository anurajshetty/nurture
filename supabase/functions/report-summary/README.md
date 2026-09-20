# report-summary — Supabase Edge Function

Sends a pregnancy health document (lab report, ultrasound printout,
discharge summary) to the Gemini API for a plain-language summary, and
returns a short descriptive title plus an auto-derived attachment name.
The API key lives **only here** as an Edge Function secret — it is never
in the app, never in git, never in a response, and document content is
never logged.

**Relevance gate (Anuraj Sept 2026):** Gemini first judges whether the
document is related to pregnancy or the baby, in the SAME structured
call (one call, not two — the response schema carries an
`isPregnancyRelated` boolean verdict). Unrelated documents are NOT
summarized: the function answers HTTP 422 `{ "error": "not_related" }`
and the app shows its transient "Report summary failed" toast. The
check can't be bypassed — it lives server-side in this function.

**Ephemeral (Anuraj Sept 2026):** the app reads the picked file into
memory and sends the bytes INLINE in the invoke body
(`{ dataBase64, mimeType }`). The function decodes them, forwards them
to Gemini, and drops them — nothing is written to Supabase Storage, and
no Storage credentials are needed. The app never persists report bytes
anywhere (no DB blob, no outbox row).

Design authority: the card design comes from approved mockup
`~/workspace/app-ideas/pregnancy-tracker/design/13-logs-add.html`
("Add report" flow + summary card on the Report timeline entry).
Anuraj's content rule below is his verbatim spec (Sept 2026).

## Status

**Implemented (Sept 19, 2026) — not yet deployed.** Code is in this
directory (`index.ts` + `lib.ts`) with unit tests
(`tests/report_summary.test.ts`) and the app side
(`src/reportSummary/client.ts` + Report-entry rendering in
`src/composer/EventCard.tsx`). Two open prerequisites (tracked with the
DOB/privacy review, not separately):

- Privacy disclosure must be updated to cover LLM processing of health
  documents before this ships (fold into the open DOB/privacy review).
- Deploy + secret setup needs Anuraj (see below); never request his key
  — surface the one-step setup when he asks.
- No confirmed clinician review of the pregnancy fact matrix; the
  summary stays general-information-only regardless.

Until the secret is set, the function answers every call with HTTP 503
`{ "error": "not_configured" }` — the app shows the "Couldn't read this
one" card with Try again (it never leaks the reason to her).

## Where the summary lives

- The upload sheet stays minimal: pick → Done ("Report saved to your
  story"). **No summary in the sheet, no attachment saved, no backup.**
- The new Report timeline entry immediately shows the interim
  "Summarizing your report…" state while the app calls this function
  with the in-memory bytes.
- The summary renders on the **Report-category log entry** at the top of
  the timeline as a dedicated, text-only card:
  - 📄 **Report** chip + timestamp + 🔒 Only you
  - Short title (serif, e.g. "Glucose results")
  - Plain-language summary body (see content rule)
  - Disclaimer (rendered by the app, not the LLM): "This isn't medical
    advice — check with your care team."
- Failure: the card shows "Couldn't read this one — try a clearer
  photo." with **Try again** (re-sends the in-memory bytes; recovers on
  tap). Never a dead end.

## Content rule (Anuraj's spec, Sept 2026 — verbatim intent)

> Keep it **short and precise** — lead with anything that needs
> attention, otherwise keep it very brief. The summary should never be a
> long paragraph; a couple of lines max unless something genuinely needs
> flagging.

Folded into the prompt as hard constraints:

1. **Lead with what needs attention.** If the report flags anything
   abnormal, borderline, or asks for a follow-up, that goes first, in
   plain words.
2. **Otherwise very brief.** The routine case is one or two lines:
   what the report is, in plain language, and that nothing in it asks
   anything of her right now.
3. **Never a long paragraph.** Two to three short sentences max, even
   when flagging something.
4. Warm, calm, neutral partner voice. General information only — no
   diagnosis, no triage, no "you should / you shouldn't". Anything that
   is a question is a prompt for her care team, not an answer from us.

Good (routine): "Your glucose screening came back in the typical range.
It checks how your body handles sugar during pregnancy — one routine
piece your care team is already watching."

Good (flagged): "One value came back a little high — your bilirubin.
Everything else looks typical. Worth asking your care team about at
your next visit."

Bad: a paragraph explaining the physiology of bilirubin metabolism.

## Prompt (as implemented in `lib.ts`)

System:

> You explain a pregnancy health document to the person it belongs to,
> in plain, warm, everyday language. Short and precise: lead with
> anything in the report that needs attention (an abnormal or borderline
> value, a follow-up the report requests). Otherwise keep it very brief
> — what the report is and that nothing in it asks anything of her right
> now. Never a long paragraph: two to three short sentences maximum.
> General information only: no diagnosis, no triage, no prescribing, no
> "you should" / "you shouldn't". Frame open questions as prompts for
> her care team. Never repeat API keys, never invent values not in the
> document; if a value is unreadable, say so once, briefly.

User: the document (image or PDF, base64) + `{"locale": "en-US"}`.

Response (strict JSON, no other fields):

```json
{
  "isPregnancyRelated": true,
  "title": "Glucose results",
  "summary": "Your glucose screening came back in the typical range. It checks how your body handles sugar during pregnancy — one routine piece your care team is already watching.",
  "attachmentName": "Glucose screening – Sep 19",
  "needsAttention": false,
  "disclaimer": "This isn't medical advice — check with your care team."
}
```

- `isPregnancyRelated`: the model's verdict — true when the document is
  related to pregnancy or the baby (prenatal labs, ultrasound/scan
  printouts, OB/midwife visit notes, delivery/postpartum discharge
  summaries, newborn/pediatric documents for the baby). When false, the
  text fields are empty strings and the document is not summarized —
  the function returns 422 `{ "error": "not_related" }` instead.
- `title`: 2–4 words naming the report, plain language, ≤50 chars.
- `summary`: the body per the content rule above, ≤400 chars.
- `attachmentName`: descriptive attachment name derived from the report's
  content + the upload date ("<What it is> – <Mon D>"); never the raw
  upload filename, ≤60 chars.
- `needsAttention`: true only when the document flags something
  abnormal/borderline or requests a follow-up.
- `disclaimer`: fixed text written by the function, never the model.
  The app renders it verbatim; it falls back to the same string when the
  function is unreachable.

Validation (mirror `week-briefing/lib.ts` conventions): structural
problems trigger one repair retry, then fail as `provider_error`;
length overruns are clamped; the app treats repeated failure as the
"Couldn't read this one" state.

## Contract

Invoke: `supabase.functions.invoke('report-summary', { body })`

Request — strict schema, **no other fields accepted** (extra → 400):

```json
{ "dataBase64": "<base64 of the document bytes>", "mimeType": "application/pdf" }
```

- `dataBase64`: the document bytes, base64-encoded, sent inline. The app
  downscales photos and caps at 10MB client-side; the function rejects
  empty, corrupt, or >12MB-decoded payloads with `unreadable` (422).
- The bytes live only for the duration of the request: decoded,
  forwarded to Gemini, dropped. Nothing is written to Storage.
- `mimeType` must be `image/jpeg`, `image/png`, `image/webp`, or
  `application/pdf` — anything else → `unsupported_type` (400).

Response: HTTP 200 with
`{ title, summary, attachmentName, needsAttention, disclaimer }`.

Errors:

| status | body | meaning |
|--------|------|---------|
| 400 | `{ error: "invalid_json" }` | body is not JSON |
| 400 | `{ error: "invalid_request" }` | bad schema — fix the caller, don't retry blindly |
| 400 | `{ error: "unsupported_type" }` | file type Gemini can't read inline |
| 405 | `{ error: "method_not_allowed" }` | non-POST |
| 422 | `{ error: "unreadable" }` | inline payload missing/corrupt/empty/too large — app shows the "Couldn't read this one" card immediately |
| 422 | `{ error: "not_related" }` | Gemini judged the document NOT pregnancy-or-baby related — not summarized; app shows the transient "Report summary failed" toast |
| 502 | `{ error: "provider_error" }` | Gemini failed — safe to retry later with backoff |
| 503 | `{ error: "not_configured" }` | secret missing — app shows the "Couldn't read this one" card with Try again |

## Privacy rules (non-negotiable)

- `GEMINI_API_KEY` only as an Edge Function secret. Never in app code,
  never in git, never in logs, never in a response.
- Never log document content, file bytes, titles, summaries, or
  request fields. Logs carry only success/failure + latency with no
  identifiers.
- Document bytes arrive inline in the request body and are never written
  to Storage or any other persistence — they exist only for the request.
- Disclosure update ships with the DOB/privacy review, not
  independently.

## Files

- `index.ts` — Deno entry: env, CORS, HTTP status mapping (mirror
  `week-briefing/index.ts`).
- `lib.ts` — validation, prompt (above), inline document decode, Gemini
  call, response validation. Deno-free so it unit-tests under node
  (`tests/report_summary.test.ts`).

## Deploy (Anuraj's step)

```sh
supabase functions deploy report-summary
```

Secret: **`GEMINI_API_KEY`** — Supabase dashboard → the **nurture**
project → Edge Functions → report-summary → Secrets (or Project
Settings → Edge Functions → Manage secrets). No redeploy needed for
secret changes.

**Note (Sept 19, 2026):** the contract changed from
`{ eventId, bucket, storagePath }` (Storage read) to
`{ dataBase64, mimeType }` (bytes inline, ephemeral). Deploying this
version of the function is Anuraj's step — the code is updated, the
deploy is not done.

## End-to-end verification

Live verification needs the secret set first (Anuraj's step above).
After deploy, in the Supabase dashboard → Edge Functions →
`report-summary` → Invoke, POST:

```json
{
  "dataBase64": "<base64 of a small test PDF>",
  "mimeType": "application/pdf"
}
```

Expected: HTTP 200 with
`{ title, summary, attachmentName, needsAttention, disclaimer }`,
or HTTP 422 `{ "error": "unreadable" }` when the payload is corrupt or
too large.
