#!/usr/bin/env python3
"""
Ask Willow interactive test (Anuraj, Sept 20, 2026) — the AI chat entry,
consent, chat, quota, at-limit, and unavailable flows, against the real
web export at 390x844 served under /willow/ (with ?testhooks=1).

`window.__askWillowTestTransport = { invoke, getQuota }` is stubbed AT
THE NETWORK LAYER: the app still crosses a real fetch boundary (via the
testhooks-gated transport in src/aiChat/client.ts) — a same-origin POST
/ GET to /functions/v1/pregnancy-chat on the test server below. No real
Supabase or Gemini traffic. The stub returns a DYNAMIC dailyLimit so the
test proves the client never hardcodes "10".

Locked behaviors under test:
  (a) entry: coral "ask" pill floats bottom-right on the Week tab only
      (absent on Logs); not a card, not a fourth tab.
  (b) consent: verbatim copy; shows on EVERY ask tap until the first
      question is sent ("Not now" dismisses, sheet returns on next tap);
      after the first sent question, ask opens chat directly.
  (c) chat: full-screen, fixed disclaimer exactly once under the header
      (never in bubbles), greeting, no starter chips, text-only.
  (d) quota: server-driven line ("11 of 12 left today" — dynamic cap);
      request bodies carry question + compact context (week, logs,
      reports, growing history) and no photos.
  (e) at-limit: 429 → calm limit card ("That's today's 12", care-team
      line, "Back at midnight"), input replaced, sysline
      "That was today's 12th — I'll be here tomorrow."
  (f) urgent handoff: works without consuming quota (remaining unchanged).
  (g) not_configured: quiet "isn't available yet" state, no crash, no
      backend error leakage.
  (h) history on device only: KV holds the turns; Q&A never enters the
      feed (Logs shows none of it).
  (i) zero page errors throughout.
  (k) no sign-in gate: a backend 401 (old server / misconfigured) is a
      plain send failure — never a sign-in prompt, never the quiet
      unavailable state.

Run: python3 tests/interactive/ai_chat_test.py
"""

import http.server
import json
import os
import time

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
PORT = 8914
BASE = os.environ.get("AI_BASE", f"http://localhost:{PORT}/willow/?testhooks=1")
LOGS = os.environ.get("AI_LOGS", f"http://localhost:{PORT}/willow/logs?testhooks=1")
# Direct week URL: the root redirect ( / -> /week ) drops the query string,
# and the testhooks-gated transport reads location.search at call time.
WEEK = os.environ.get("AI_WEEK", f"http://localhost:{PORT}/willow/week?testhooks=1")

STUB_PATH = "/functions/v1/pregnancy-chat"

# Mutable stub behavior, flipped by the test between phases.
stub_state = {"mode": "delayed-ok", "dailyLimit": 12, "used": 0, "hold": 3}
seen_requests = []

CONSENT_TITLE = "Before you ask"
CONSENT_LEDE = "This chat answers your pregnancy questions using AI."
CONSENT_BULLET_1 = "Your conversation stays on this phone — we don’t keep a copy of your chats."
CONSENT_BULLET_2 = "This is general information only, not medical advice. If something feels urgent or wrong, call your care team — don’t wait on an answer here."
DISCLAIMER = "This isn't medical advice."
GREETING = "Hi — ask me anything about your pregnancy or the weeks ahead."
HANDOFF_TEXT = "That sounds like something to bring to your care team right away — they can help in a way a chat can't."


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def _send_json(self, status, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = self.path.split("?")[0]
        if path != STUB_PATH:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            seen_requests.append(json.loads(raw or b"{}"))
        except Exception:
            seen_requests.append(None)
        mode = stub_state["mode"]
        limit = stub_state["dailyLimit"]
        if mode == "not-configured":
            self._send_json(503, b'{"error":"not_configured"}')
            return
        if mode == "quota-down":
            # Quota store unreachable: server fails closed (503). The client
            # must show a plain send failure, NOT the unavailable state.
            self._send_json(503, json.dumps({"error": "quota_unavailable", "dailyLimit": limit}).encode())
            return
        if mode == "unauthorized-401":
            # Simulates an OLD server that still 401s callers without a
            # login. There is no sign-in gate (Anuraj, Sept 20, 2026), so
            # the client must degrade to a plain send failure — never a
            # sign-in prompt, never the quiet unavailable state.
            self._send_json(401, b'{"error":"unauthorized"}')
            return
        if mode == "limit":
            # Urgent questions still get the free handoff at the limit.
            try:
                q = (json.loads(raw or b"{}").get("question") or "").lower()
            except Exception:
                q = ""
            if "bleed" in q or "water broke" in q:
                self._send_json(
                    200,
                    json.dumps(
                        {
                            "kind": "handoff",
                            "text": HANDOFF_TEXT,
                            "disclaimer": DISCLAIMER,
                            "remaining": 0,
                            "dailyLimit": limit,
                        }
                    ).encode(),
                )
                return
            self._send_json(429, json.dumps({"error": "limit_reached", "dailyLimit": limit}).encode())
            return
        body_in = {}
        try:
            body_in = json.loads(raw or b"{}")
        except Exception:
            pass
        question = str(body_in.get("question") or "")
        # Urgent pre-check behavior: free handoff, no quota consumed.
        if "bleed" in question.lower() or "water broke" in question.lower():
            self._send_json(
                200,
                json.dumps(
                    {
                        "kind": "handoff",
                        "text": HANDOFF_TEXT,
                        "disclaimer": DISCLAIMER,
                        "remaining": limit - stub_state["used"],
                        "dailyLimit": limit,
                    }
                ).encode(),
            )
            return
        if mode == "refusal":
            self._send_json(
                200,
                json.dumps(
                    {
                        "kind": "refusal",
                        "text": "I only answer pregnancy and baby questions.",
                        "disclaimer": DISCLAIMER,
                        "remaining": limit - stub_state["used"],
                        "dailyLimit": limit,
                    }
                ).encode(),
            )
            return
        if stub_state["hold"]:
            time.sleep(stub_state["hold"])
        stub_state["used"] += 1
        remaining = limit - stub_state["used"]
        self._send_json(
            200,
            json.dumps(
                {
                    "kind": "answer",
                    "text": f"Stub answer to: {question[:60]}",
                    "disclaimer": DISCLAIMER,
                    "remaining": remaining,
                    "dailyLimit": limit,
                }
            ).encode(),
        )

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == STUB_PATH:
            limit = stub_state["dailyLimit"]
            if stub_state["mode"] == "not-configured":
                self._send_json(503, b'{"error":"not_configured"}')
            elif stub_state["mode"] == "unauthorized-401":
                self._send_json(401, b'{"error":"unauthorized"}')
            else:
                self._send_json(
                    200,
                    json.dumps(
                        {
                            "remaining": limit - stub_state["used"],
                            "dailyLimit": limit,
                            "configured": True,
                        }
                    ).encode(),
                )
            return
        query = self.path[len(path):]
        if path.startswith("/willow/"):
            rel = path[len("/willow/"):]
            if not rel or not os.path.isfile(os.path.join(DIST, rel)):
                rel = "index.html"
            self.path = "/" + rel + query
        return super().do_GET()

    def log_message(self, *args):
        pass


# Installed before the app boots: same-origin fetch to the stub above.
INIT_SCRIPT = """
window.__askWillowTestTransport = {
  invoke: async (body) => {
    const res = await fetch('/functions/v1/pregnancy-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) return { data, error: { message: 'stub http ' + res.status } };
    return { data, error: null };
  },
  getQuota: async () => {
    const res = await fetch('/functions/v1/pregnancy-chat', { method: 'GET' });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = new Error('stub quota http ' + res.status);
      err.context = { status: res.status };
      throw err;
    }
    return data;
  },
};
"""


def run():
    from playwright.sync_api import sync_playwright

    passed, failed = 0, 0
    errors: list = []

    def check(cond, name):
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f"  ok: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    import threading

    threading.Thread(target=server.serve_forever, daemon=True).start()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )

        # ---------------- context A: entry / consent / chat / quota / limit
        print("Context A: entry, consent, chat, quota, at-limit")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(INIT_SCRIPT)
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        seeded = False
        for _ in range(30):
            try:
                page.evaluate(
                    """() => {
                        window.__nurtureTest.completeOnboarding();
                        window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                        window.__nurtureTest.resetAiChat();
                        window.__nurtureTest.seedEvent({ type: 'symptom', occurredAt: new Date().toISOString(), data: { text: 'mild backache this morning' } });
                        window.__nurtureTest.seedEvent({ type: 'report', occurredAt: new Date().toISOString(), data: { reportSummary: { status: 'ready', title: 'Growth scan', summary: 'typical for this stage' } } });
                    }"""
                )
                seeded = True
                break
            except Exception:
                page.wait_for_timeout(2000)
        if not seeded:
            print("  FAIL: seeding never succeeded")
            raise SystemExit(1)
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.wait_for_timeout(500)

        # (a) entry: pill on Week only, not a tab.
        fab = page.get_by_test_id("ask-fab")
        check(fab.count() == 1, "(a) ask pill visible on the Week tab")
        check("ask" in (fab.first.inner_text() or ""), "(a) pill is labeled 'ask'")
        tabs = page.evaluate("() => document.querySelectorAll('[role=\"tab\"]').length")
        check(tabs == 3, f"(a) still 3 tabs, not a fourth (found {tabs})")
        box = fab.first.bounding_box()
        check(box is not None and box["x"] + box["width"] > 300 and box["height"] >= 56,
              "(a) pill floats bottom-right at 56pt")
        page.goto(LOGS, wait_until="domcontentloaded")
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        check(page.get_by_test_id("ask-fab").count() == 0, "(a) no ask pill on Logs tab")
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)

        # (b) consent repeats until the first question is sent.
        page.get_by_test_id("ask-fab").click()
        try:
            page.get_by_test_id("consent-sheet").wait_for(timeout=5000)
            check(True, "(b) consent sheet opens on ask tap")
        except Exception:
            check(False, "(b) consent sheet opens on ask tap")
        sheet_text = page.get_by_test_id("consent-sheet").inner_text()
        check(CONSENT_TITLE in sheet_text, "(b) consent title verbatim")
        check(CONSENT_LEDE in sheet_text, "(b) consent lede verbatim")
        check(CONSENT_BULLET_1 in sheet_text, "(b) consent bullet 1 verbatim")
        check(CONSENT_BULLET_2 in sheet_text, "(b) consent bullet 2 verbatim")
        check(page.get_by_test_id("consent-not-now").count() == 1, "(b) 'Not now' present")
        check(page.get_by_test_id("consent-understand").count() == 1, "(b) 'I understand' present")
        page.get_by_test_id("consent-not-now").click()
        page.wait_for_timeout(600)
        check(page.get_by_test_id("consent-sheet").count() == 0, "(b) 'Not now' dismisses")
        page.get_by_test_id("ask-fab").click()
        try:
            page.get_by_test_id("consent-sheet").wait_for(timeout=5000)
            check(True, "(b) consent returns on next tap (no question sent yet)")
        except Exception:
            check(False, "(b) consent returns on next tap (no question sent yet)")

        # (c) chat: header, disclaimer once, greeting, no chips, quota line.
        page.get_by_test_id("consent-understand").click()
        try:
            page.get_by_test_id("ask-chat-messages").wait_for(timeout=8000)
            check(True, "(c) chat opens full-screen")
        except Exception:
            check(False, "(c) chat opens full-screen")
        check("Ask Willow" in page.content(), "(c) 'Ask Willow' header")
        check("‹ Week" in page.content(), "(c) '‹ Week' back label")
        disc_count = page.evaluate(
            "() => Array.from(document.querySelectorAll('*')).filter(el => (el.textContent||'').trim() === \"This isn't medical advice.\" && el.children.length === 0).length"
        )
        check(disc_count == 1, f"(c) disclaimer appears exactly once (found {disc_count})")
        check(GREETING in page.content(), "(c) empty-state greeting, no starter chips")
        check(page.locator('[data-testid="ask-chat-chip"]').count() == 0, "(c) no starter chips")
        check(page.get_by_test_id("ask-chat-input").count() == 1, "(c) text input present")
        check(page.locator('input[type="file"], [aria-label*="microphone" i], [aria-label*="voice" i]').count() == 0,
              "(c) no mic/voice/recording UI")
        try:
            page.get_by_test_id("ask-chat-quota").wait_for(timeout=8000)
            quota_text = page.get_by_test_id("ask-chat-quota").inner_text()
            check(quota_text == "12 of 12 left today",
                  f"(c) dynamic server quota line (got '{quota_text}')")
        except Exception:
            check(False, "(c) quota line renders")

        # (d) send Q1: bubbles, typing, request body, quota decrement.
        n_before = len(seen_requests)
        page.get_by_test_id("ask-chat-input").fill("Is light walking okay?")
        page.get_by_test_id("ask-chat-send").click()
        try:
            page.get_by_test_id("ask-chat-typing").wait_for(timeout=5000)
            check(True, "(d) typing indicator while the stub holds")
        except Exception:
            check(False, "(d) typing indicator while the stub holds")
        try:
            page.get_by_test_id("ask-chat-willow").wait_for(timeout=15000)
            check(True, "(d) Willow answer bubble renders")
        except Exception:
            check(False, "(d) Willow answer bubble renders")
        check(page.get_by_test_id("ask-chat-user").count() == 1, "(d) user bubble renders")
        body_text = page.get_by_test_id("ask-chat-messages").inner_text()
        check("Stub answer to: Is light walking okay?" in body_text, "(d) stub answer text shown")
        check(page.evaluate("() => window.__nurtureTest.hasAskedFirstQuestion()") is True,
              "(d) first-question flag set after send")
        reqs = seen_requests[n_before:]
        check(len(reqs) == 1 and isinstance(reqs[0], dict), "(d) exactly one chat request sent")
        req = reqs[0] or {}
        check(req.get("question") == "Is light walking okay?", "(d) question in body")
        ctx_in = req.get("context") or {}
        check(ctx_in.get("week") == 38, f"(d) context carries week 38 (got {ctx_in.get('week')})")
        check(len(ctx_in.get("recentLogs") or []) >= 1, "(d) context carries recent log summaries")
        check(len(ctx_in.get("reportSummaries") or []) >= 1, "(d) context carries report summaries")
        check((ctx_in.get("history") or []) == [], "(d) first request has empty history")
        check("dataBase64" not in req and "photo" not in json.dumps(req).lower(),
              "(d) no photos in the request")
        page.get_by_test_id("ask-chat-quota").wait_for(timeout=8000)
        check(page.get_by_test_id("ask-chat-quota").inner_text() == "11 of 12 left today",
              "(d) quota line decrements from the server response")

        # (d2) Q2: history grows in the request.
        n_before = len(seen_requests)
        page.get_by_test_id("ask-chat-input").fill("What about swimming?")
        page.get_by_test_id("ask-chat-send").click()
        page.get_by_text("Stub answer to: What about swimming?").wait_for(timeout=15000)
        req2 = (seen_requests[n_before:] or [{}])[0]
        hist2 = ((req2.get("context") or {}).get("history")) or []
        check(len(hist2) == 2, f"(d) second request carries 2 prior turns (got {len(hist2)})")

        # (h) Q&A stays out of the feed; (b2) ask opens chat directly now.
        hist_json = page.evaluate("() => window.__nurtureTest.getAiChatHistoryJson()")
        hist = json.loads(hist_json)
        check(len(hist) == 4, f"(h) on-device history holds 4 turns (got {len(hist)})")
        page.get_by_test_id("ask-chat-back").click()
        page.wait_for_timeout(600)
        page.goto(LOGS, wait_until="domcontentloaded")
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        logs_text = page.get_by_test_id("logs-screen").inner_text()
        check("Is light walking okay?" not in logs_text and "What about swimming?" not in logs_text,
              "(h) Q&A never enters the feed")
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.get_by_test_id("ask-fab").click()
        page.wait_for_timeout(800)
        check(page.get_by_test_id("consent-sheet").count() == 0, "(b) no consent after first question")
        check(page.get_by_test_id("ask-chat-messages").count() == 1, "(b) ask opens chat directly")
        disc_count = page.evaluate(
            "() => Array.from(document.querySelectorAll('*')).filter(el => (el.textContent||'').trim() === \"This isn't medical advice.\" && el.children.length === 0).length"
        )
        check(disc_count == 1, "(c) disclaimer still exactly once on reopen")

        # (e) at-limit: 429 → calm limit card, input replaced.
        stub_state["mode"] = "limit"
        page.get_by_test_id("ask-chat-input").fill("One more question")
        page.get_by_test_id("ask-chat-send").click()
        try:
            page.get_by_test_id("ask-chat-limit").wait_for(timeout=8000)
            check(True, "(e) limit card replaces the input")
        except Exception:
            check(False, "(e) limit card replaces the input")
        limit_text = page.get_by_test_id("ask-chat-limit").inner_text()
        check("That’s today’s 12" in limit_text, "(e) at-limit title uses the server cap (12)")
        check("your care team is the right call" in limit_text, "(e) care-team line")
        check("Back at midnight" in limit_text, "(e) 'Back at midnight' footer")
        check("paywall" not in limit_text.lower() and "streak" not in limit_text.lower(),
              "(e) no paywall/streak/countdown")
        check(page.get_by_test_id("ask-chat-input").count() == 0, "(e) input gone at the limit")
        check("That was today’s 12th — I’ll be here tomorrow." in
              page.get_by_test_id("ask-chat-messages").inner_text(),
              "(e) last-question sysline")
        page.get_by_test_id("ask-chat-back").click()
        page.wait_for_timeout(600)

        # (f) urgent handoff: free, quota unconsumed.
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.on("pageerror", lambda e: errors.append(str(e)))
        page2.add_init_script(INIT_SCRIPT)
        stub_state["mode"] = "delayed-ok"
        stub_state["hold"] = 0
        stub_state["used"] = 0
        # Boot, seed, THEN land on Week (the screen renders once on mount).
        page2.goto(BASE, wait_until="networkidle")
        page2.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page2.evaluate(
            """() => {
                window.__nurtureTest.completeOnboarding();
                window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                window.__nurtureTest.resetAiChat();
            }"""
        )
        page2.goto(WEEK, wait_until="domcontentloaded")
        page2.get_by_test_id("week-screen").wait_for(timeout=15000)
        page2.wait_for_timeout(500)
        page2.get_by_test_id("ask-fab").click()
        page2.get_by_test_id("consent-sheet").wait_for(timeout=5000)
        page2.get_by_test_id("consent-understand").click()
        page2.get_by_test_id("ask-chat-messages").wait_for(timeout=8000)
        page2.get_by_test_id("ask-chat-input").fill("I'm bleeding, what do I do?")
        page2.get_by_test_id("ask-chat-send").click()
        try:
            page2.get_by_text(HANDOFF_TEXT).wait_for(timeout=10000)
            check(True, "(f) urgent handoff bubble renders")
        except Exception:
            check(False, "(f) urgent handoff bubble renders")
        check(stub_state["used"] == 0, "(f) handoff consumed no quota")
        page2.get_by_test_id("ask-chat-quota").wait_for(timeout=8000)
        check(page2.get_by_test_id("ask-chat-quota").inner_text() == "12 of 12 left today",
              "(f) quota untouched after handoff")
        ctx2.close()

        # (g) not-configured: quiet unavailable state.
        ctx3 = browser.new_context(viewport={"width": 390, "height": 844})
        page3 = ctx3.new_page()
        page3.on("pageerror", lambda e: errors.append(str(e)))
        page3.add_init_script(INIT_SCRIPT)
        stub_state["mode"] = "not-configured"
        # Boot, seed, THEN land on Week (the screen renders once on mount).
        page3.goto(BASE, wait_until="networkidle")
        page3.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page3.evaluate(
            """() => {
                window.__nurtureTest.completeOnboarding();
                window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                window.__nurtureTest.resetAiChat();
            }"""
        )
        page3.goto(WEEK, wait_until="domcontentloaded")
        page3.get_by_test_id("week-screen").wait_for(timeout=15000)
        page3.wait_for_timeout(500)
        page3.get_by_test_id("ask-fab").click()
        page3.get_by_test_id("consent-sheet").wait_for(timeout=5000)
        page3.get_by_test_id("consent-understand").click()
        try:
            page3.get_by_test_id("ask-chat-unavailable").wait_for(timeout=8000)
            check(True, "(g) quiet unavailable state")
        except Exception:
            check(False, "(g) quiet unavailable state")
        unav = page3.get_by_test_id("ask-chat-unavailable").inner_text()
        check("isn’t available yet" in unav, "(g) unavailable copy, no backend error leakage")
        check("503" not in unav and "not_configured" not in unav, "(g) no error-code leakage")
        check(page3.get_by_test_id("ask-chat-input").count() == 0, "(g) no input when unavailable")
        disc3 = page3.evaluate(
            "() => Array.from(document.querySelectorAll('*')).filter(el => (el.textContent||'').trim() === \"This isn't medical advice.\" && el.children.length === 0).length"
        )
        check(disc3 == 1, "(g) disclaimer still exactly once when unavailable")
        ctx3.close()

        # (j) quota store down: server fails closed; the client shows a
        # plain send failure, never the quiet unavailable state.
        ctx4 = browser.new_context(viewport={"width": 390, "height": 844})
        page4 = ctx4.new_page()
        page4.on("pageerror", lambda e: errors.append(str(e)))
        page4.add_init_script(INIT_SCRIPT)
        stub_state["mode"] = "quota-down"
        stub_state["used"] = 0
        page4.goto(BASE, wait_until="networkidle")
        page4.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page4.evaluate(
            """() => {
                window.__nurtureTest.completeOnboarding();
                window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                window.__nurtureTest.resetAiChat();
            }"""
        )
        page4.goto(WEEK, wait_until="domcontentloaded")
        page4.get_by_test_id("week-screen").wait_for(timeout=15000)
        page4.wait_for_timeout(500)
        page4.get_by_test_id("ask-fab").click()
        page4.get_by_test_id("consent-sheet").wait_for(timeout=5000)
        page4.get_by_test_id("consent-understand").click()
        page4.get_by_test_id("ask-chat-input").wait_for(timeout=8000)
        page4.get_by_test_id("ask-chat-input").fill("Is light walking okay?")
        page4.get_by_test_id("ask-chat-send").click()
        try:
            page4.get_by_text("try again in a moment").wait_for(timeout=8000)
            check(True, "(j) quota outage → plain send failure")
        except Exception:
            check(False, "(j) quota outage → plain send failure")
        check(page4.get_by_test_id("ask-chat-unavailable").count() == 0,
              "(j) quota outage is not the unavailable state")
        check(page4.get_by_test_id("ask-chat-input").count() == 1,
              "(j) chat stays usable after the failed send")
        ctx4.close()

        # (k) no sign-in gate: a backend 401 is a plain send failure.
        ctx5 = browser.new_context(viewport={"width": 390, "height": 844})
        page5 = ctx5.new_page()
        page5.on("pageerror", lambda e: errors.append(str(e)))
        page5.add_init_script(INIT_SCRIPT)
        stub_state["mode"] = "unauthorized-401"
        stub_state["used"] = 0
        page5.goto(BASE, wait_until="networkidle")
        page5.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page5.evaluate(
            """() => {
                window.__nurtureTest.completeOnboarding();
                window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                window.__nurtureTest.resetAiChat();
            }"""
        )
        page5.goto(WEEK, wait_until="domcontentloaded")
        page5.get_by_test_id("week-screen").wait_for(timeout=15000)
        page5.wait_for_timeout(500)
        page5.get_by_test_id("ask-fab").click()
        page5.get_by_test_id("consent-sheet").wait_for(timeout=5000)
        page5.get_by_test_id("consent-understand").click()
        # A 401 on the quota load must NOT gate the chat.
        try:
            page5.get_by_test_id("ask-chat-input").wait_for(timeout=8000)
            check(True, "(k) chat opens after a 401 quota load (no sign-in gate)")
        except Exception:
            check(False, "(k) chat opens after a 401 quota load (no sign-in gate)")
        check(page5.get_by_test_id("ask-chat-unavailable").count() == 0,
              "(k) 401 quota load is not the unavailable state")
        page5.get_by_test_id("ask-chat-input").fill("Is light walking okay?")
        page5.get_by_test_id("ask-chat-send").click()
        try:
            page5.get_by_text("try again in a moment").wait_for(timeout=8000)
            check(True, "(k) 401 on send → plain send failure")
        except Exception:
            check(False, "(k) 401 on send → plain send failure")
        body5 = page5.get_by_test_id("ask-chat-messages").inner_text()
        check("Sign in" not in body5 and "sign in" not in body5.lower(),
              "(k) no sign-in copy anywhere")
        check(page5.get_by_test_id("ask-chat-unavailable").count() == 0,
              "(k) 401 on send is not the unavailable state")
        ctx5.close()
        ctx.close()

        # (i) zero page errors.
        check(len(errors) == 0, f"(i) zero page errors (got {len(errors)}: {errors[:3]})")

        browser.close()

    server.shutdown()
    print(f"=== ai_chat interactive: {passed} passed, {failed} failed ===")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    run()
