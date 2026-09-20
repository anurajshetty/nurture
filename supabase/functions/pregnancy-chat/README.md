# Ask Willow — `pregnancy-chat` edge function

One-time setup, done by Anuraj in the Supabase dashboard (like the
`report-summary` function before it). Engineering cannot do these
steps; they need a signed-in dashboard owner.

Project: **nurture** (`sgmjsqkmuzizrnrhwjvu`, West US).

## Step 1 — Create the quota table + functions (one-time SQL)

This is the one unavoidable database step: the daily question cap is
enforced by the server (not the app), so the server needs a place to
keep per-person counters. Supabase dashboard → project **nurture** →
left nav **SQL Editor** → **New query**, paste this whole block,
**Run**:

```sql
-- Ask Willow quota counters. Counters ONLY — no conversations,
-- questions, or answers are ever stored here. One paste, ~30 seconds.
create table if not exists ai_chat_quota (
  user_id uuid not null,
  day date not null,
  count int not null default 0,
  window_start timestamptz,
  window_count int not null default 0,
  primary key (user_id, day)
);

alter table ai_chat_quota enable row level security;

-- Each person sees and touches ONLY their own rows. The edge function
-- calls with the caller's own login token, so this policy is what
-- enforces "per person".
drop policy if exists "own quota rows" on ai_chat_quota;
create policy "own quota rows" on ai_chat_quota
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomic check-and-consume: one locked statement, so two taps at the
-- same moment can't both slip under the cap. Same rules as the app
-- spec: the daily cap (default 10, configurable) plus a 5-per-60-seconds
-- burst window.
create or replace function ai_chat_try_consume(p_user_id uuid, p_day date, p_limit int)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  now_ts timestamptz := now();
  r record;
begin
  if uid is null or uid <> p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  insert into ai_chat_quota (user_id, day, count, window_start, window_count)
  values (uid, p_day, 0, now_ts, 0)
  on conflict (user_id, day) do nothing;
  select * into r from ai_chat_quota
  where user_id = uid and day = p_day
  for update;
  if r.window_start is null or r.window_start <= now_ts - make_interval(secs => 60) then
    r.window_start := now_ts;
    r.window_count := 0;
  end if;
  if r.count >= p_limit then
    update ai_chat_quota
    set window_start = r.window_start, window_count = r.window_count
    where user_id = uid and day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'daily', 'remaining', 0);
  end if;
  if r.window_count >= 5 then
    update ai_chat_quota
    set window_start = r.window_start, window_count = r.window_count
    where user_id = uid and day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'burst',
      'remaining', greatest(p_limit - r.count, 0));
  end if;
  update ai_chat_quota
  set count = r.count + 1,
      window_start = r.window_start,
      window_count = r.window_count + 1
  where user_id = uid and day = p_day;
  return jsonb_build_object('ok', true,
    'remaining', greatest(p_limit - r.count - 1, 0));
end $$;

-- Give back one question when the AI provider fails mid-request, so a
-- glitch never eats into her 10.
create or replace function ai_chat_refund(p_user_id uuid, p_day date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return;
  end if;
  update ai_chat_quota
  set count = greatest(count - 1, 0),
      window_count = greatest(window_count - 1, 0)
  where user_id = auth.uid() and day = p_day;
end $$;

grant execute on function ai_chat_try_consume(uuid, date, int) to authenticated;
grant execute on function ai_chat_refund(uuid, date) to authenticated;

-- ================================================================
-- TEMPORARY anonymous bucket (Anuraj, Sept 20, 2026): sign-in is NOT
-- required to ask for now, so callers without a login share ONE small
-- daily bucket instead of being turned away. The endpoint URL is
-- public, so this stays modest (default 30 questions/day for ALL
-- anonymous callers combined, set CHAT_ANON_DAILY_LIMIT on the
-- function to change it) — anyone with the URL can burn it, and the
-- worst case is bounded to that many Gemini calls per day. Same atomic
-- consume + refund rules as the per-person path.
--
-- Access goes ONLY through the security-definer RPCs below (granted to
-- `anon`). The table has RLS enabled with NO permissive policies, so
-- direct PostgREST reads/writes to the table itself are denied — the
-- bucket can only be spent through these capped functions. No IPs and
-- no identifiers are stored, only day counters.
-- ================================================================

create table if not exists ai_chat_anon_quota (
  day date primary key,
  count int not null default 0,
  window_start timestamptz,
  window_count int not null default 0
);

alter table ai_chat_anon_quota enable row level security;
-- (No policies: deny-all for direct access. The RPCs below run as the
-- function owner via `security definer`.)

create or replace function ai_chat_try_consume_anon(p_day date, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  r record;
begin
  insert into ai_chat_anon_quota (day, count, window_start, window_count)
  values (p_day, 0, now_ts, 0)
  on conflict (day) do nothing;
  select * into r from ai_chat_anon_quota
  where day = p_day
  for update;
  if r.window_start is null or r.window_start <= now_ts - make_interval(secs => 60) then
    r.window_start := now_ts;
    r.window_count := 0;
  end if;
  if r.count >= p_limit then
    update ai_chat_anon_quota
    set window_start = r.window_start, window_count = r.window_count
    where day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'daily', 'remaining', 0);
  end if;
  if r.window_count >= 5 then
    update ai_chat_anon_quota
    set window_start = r.window_start, window_count = r.window_count
    where day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'burst',
      'remaining', greatest(p_limit - r.count, 0));
  end if;
  update ai_chat_anon_quota
  set count = r.count + 1,
      window_start = r.window_start,
      window_count = r.window_count + 1
  where day = p_day;
  return jsonb_build_object('ok', true,
    'remaining', greatest(p_limit - r.count - 1, 0));
end $$;

create or replace function ai_chat_anon_peek(p_day date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  select count into c from ai_chat_anon_quota where day = p_day;
  return coalesce(c, 0);
end $$;

create or replace function ai_chat_refund_anon(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update ai_chat_anon_quota
  set count = greatest(count - 1, 0),
      window_count = greatest(window_count - 1, 0)
  where day = p_day;
end $$;

grant execute on function ai_chat_try_consume_anon(date, int) to anon;
grant execute on function ai_chat_anon_peek(date) to anon;
grant execute on function ai_chat_refund_anon(date) to anon;
```

Expected: `Success. No rows returned.`

## Step 2 — Create the function

Dashboard → project **nurture** → left nav **Edge Functions** →
**Create a new function** (or **Deploy a new function**) →
name it exactly:

```
pregnancy-chat
```

Create it, then replace the default `index.ts` with the entire contents
of `pregnancy-chat-single.ts` (the self-contained paste-ready file), and
**Deploy** / **Save**.

The deploy is done when the function list shows `pregnancy-chat` with a
recent "Deployed" time.

## Step 3 — Set the Gemini secret

Dashboard → project **nurture** → left nav **Edge Functions** →
**Secrets** (or the function's **Settings**) →
**Add a new secret**:

- Name: `GEMINI_API_KEY`
- Value: the same Gemini API key already used for `report-summary`.

Save. (No redeploy needed after adding a secret.)

Optional: to change the per-person daily question cap, add another
secret named `CHAT_DAILY_LIMIT` with a whole number (1–100). Default is
10; the app always shows whatever the server reports.

Optional: to change the temporary shared anonymous bucket (the small
daily cap for callers WITHOUT a login — Anuraj, Sept 20, 2026), add a
secret named `CHAT_ANON_DAILY_LIMIT` with a whole number (1–100).
Default is 30 questions/day **shared by all anonymous callers** — keep
it modest, because the endpoint URL is public and anyone with it can
burn the bucket.

## Step 4 — Verify

In the `pregnancy-chat` function page, use **Test** / **Invoke**:

- Method **GET** → should return
  `{"remaining": 10, "dailyLimit": 10, "configured": true}` (or the
  configured limit) **when the test call carries a user token**, and
  `{"remaining": 30, "dailyLimit": 30, "configured": true}` (or the
  configured anonymous cap) **when it carries no token**. No token no
  longer means a 401 — anonymous callers get the shared bucket.
- Method **POST** with body
  `{"question": "Is light walking okay?", "context": {"week": 36, "stage": "third trimester", "dueDate": "2026-10-08", "babyName": null, "recentLogs": [], "reportSummaries": [], "history": []}}`
  → 200 with `{"kind": "answer", "text": "…", "disclaimer": "This isn't medical advice.", "remaining": 9, "dailyLimit": 10}`.

If GET returns `{"error": "not_configured"}` (HTTP 503), the
`GEMINI_API_KEY` secret isn't set — repeat step 3.

Then open Willow → **Week** tab: the coral **ask** pill appears
bottom-right. Tap it, accept the consent once, ask the first question —
the chat answers. Before this function is deployed, the pill quietly
says Ask Willow isn't available yet, and nothing crashes.

## What the function does

- Answers pregnancy/baby questions via Gemini with a strict relevance
  + safety gate; off-topic, diagnostic, dosing, and crisis requests are
  refused or handed to the care team with fixed app copy.
- Enforces 10 questions/day per signed-in person (server-configurable)
  plus a 5-per-minute rolling window — atomically on the server, so the
  cap can't be slipped past and one person can never touch another's
  counter. Callers WITHOUT a login share ONE small daily bucket
  (default 30/day for all anonymous callers combined,
  server-configurable via `CHAT_ANON_DAILY_LIMIT`) — temporary until the
  auth story is decided; tight because the endpoint URL is public.
  Anonymous spend goes only through the `ai_chat_*_anon` RPCs (the
  bucket table has no anon RLS policies), and stores no identifiers.
  If the quota store itself is unreachable, the request fails closed
  rather than silently over-admitting. A provider failure refunds the
  question. Urgent-symptom handoffs bypass quota and never consume it.
- Stores NO conversations: only the per-day counter rows above. History
  lives on her phone only.

## Changing the daily limits later

Edge Functions → `pregnancy-chat` → Secrets → edit `CHAT_DAILY_LIMIT`
(per-person cap) or `CHAT_ANON_DAILY_LIMIT` (shared anonymous bucket) →
Save. Takes effect immediately; the app reads the new number from the
server and shows it without an app update.
