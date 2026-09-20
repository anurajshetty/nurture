# report-summary — Supabase Edge Function (spec — not yet implemented)

Sends an uploaded pregnancy health document (lab report, ultrasound
printout, discharge summary) to the Gemini API for a plain-language
summary, and returns a short descriptive title plus an auto-derived
attachment name. The API key lives **only here** as an Edge Function
secret — it is never in the app, never in git, never in a response, and
document content is never logged.

Design authority: the card design comes from approved mockup
`~/workspace/app-ideas/pregnancy-tracker/design/13-logs-add.html`
("Add report" flow + summary card on the Report timeline entry).
Anuraj's content rule below is his verbatim spec (Sept 2026).

## Status

**Spec only — do not implement until Anuraj green-lights the phase.**
Open prerequisites (tracked with the DOB/privacy review, not separately):

- Privacy disclosure must be updated to cover LLM processing of health
  documents before this ships (fold into the open DOB/privacy review).
- Secret setup needs Anuraj (`GEMINI_API_KEY`); never request his key —
  surface the one-step setup when he asks.
- No confirmed clinician review of the pregnancy fact matrix; the
  summary stays general-information-only regardless.

## Where the summary lives

- The upload sheet stays minimal: upload → Done ("Report saved to your
  story"). **No summary in the sheet.**
- After upload, the app shows a "Reading your report…" state on the new
  Report timeline entry, then calls this function.
- The summary renders on the **Report-category log entry** at the top of
  the timeline as a dedicated card:
  - 📄 **Report** chip + timestamp + 🔒 Only you
  - Short title (serif, e.g. "Glucose results")
  - Plain-language summary body (see content rule)
  - Attachment row: LLM-derived descriptive name (e.g. "Glucose screening
    – Sep 19", never the raw filename), caption "Auto-named from your
    report", **Open ›** opens the original file
  - Disclaimer (rendered by the app, not the LLM): "**This isn't medical
    advice** — it's just here to help you understand your report. Your
    care team knows your full picture, so check with them about anything
    here."
- Failure: the card shows "Couldn't read this one — try a clearer
  photo." with **Try again** (recovers on tap). Never a dead end.

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

## Prompt sketch (for `lib.ts` when the phase is built)

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
  "title": "Glucose results",
  "summary": "Your glucose screening came back in the typical range. It checks how your body handles sugar during pregnancy — one routine piece your care team is already watching.",
  "fileName": "Glucose screening – Sep 19"
}
```

- `title`: 2–4 words naming the report, plain language.
- `summary`: the body per the content rule above.
- `fileName`: descriptive attachment name derived from the report's
  content + the upload date ("<What it is> – <Mon D>"); never the raw
  upload filename.

Validation (mirror `week-briefing/lib.ts` conventions): reject
non-JSON, missing/empty fields, or a summary over ~500 characters with a
retry-or-fallback; the app treats repeated failure as the "Couldn't read
this one" state.

## Contract (planned)

Invoke: `supabase.functions.invoke('report-summary', { body })`

Request — strict schema, **no other fields accepted** (extra → 400):

```json
{ "eventId": "uuid", "storagePath": "reports/<uuid>.pdf", "mimeType": "application/pdf" }
```

- The function reads the file from Supabase Storage itself; the app
  never ships file bytes through the invoke call.
- `eventId` must belong to the caller's own pregnancy (auth via the
  caller's JWT, service-side check).

Response:

```json
{ "title": "...", "summary": "...", "fileName": "..." }
```

Errors: `not_configured` (503, secret missing — app keeps the entry
without a summary, offers Try again later); `unreadable` (422 — app
shows the "Couldn't read this one" card immediately).

## Privacy rules (non-negotiable)

- `GEMINI_API_KEY` only as an Edge Function secret. Never in app code,
  never in git, never in logs, never in a response.
- Never log document content, file bytes, or provider/patient
  identifiers. Log only event ids + success/failure + latency.
- The app uploads the file to her private Storage bucket first; the
  function reads it server-side. No document bytes in client logs.
- Disclosure update ships with the DOB/privacy review, not
  independently.

## Files (when built)

- `index.ts` — Deno entry: env, CORS, HTTP status mapping (mirror
  `week-briefing/index.ts`).
- `lib.ts` — validation, prompt (above), Gemini call, response
  validation. Deno-free so it unit-tests under node
  (`tests/report_summary.test.ts`).

## Deploy (Anuraj's step, when the phase is approved)

```sh
supabase functions deploy report-summary
```

Secret: **`GEMINI_API_KEY`** via dashboard → Edge Functions → Secrets.
