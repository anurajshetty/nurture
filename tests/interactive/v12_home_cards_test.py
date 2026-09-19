#!/usr/bin/env python3
"""
v1.2 interactive test: Epics 4.5/4.7 logging + v1.2 Home cards.

Drives the REAL merged Nurture web UI in real Chromium (phone viewport)
against the fresh dist/ served under /nurture/ via Playwright route interception.

Flows:
  1. boot with ?testhooks=1 -> home-screen renders, zero page errors
  2. Track 2: seed future appointment (+2d, 3 questions, 1 dismissed) ->
     Visit prep card (testID home-visit-prep) shows "2 questions waiting in your inbox"
  3. Track 2: seed milestone ("First kicks", now) ->
     Milestone celebrated card (testID home-milestone-celebrated) shows "saved to your story"
  4. Track 1 (end-to-end): Logs composer -> type appointment text -> Save moment ->
     "Save as appointment?" proposal sheet shows the "When?" date row ->
     pick a date 2 days out -> Save proposal -> Home shows the visit-prep card
     for the newly logged appointment (occurredAt honored end-to-end)
  5. Epic 9 C3: stopPregnancy() -> afterwards Home shows NEITHER v1.2 card
  6. zero page errors throughout
"""

import datetime
import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/nurture/?testhooks=1"

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = Date.now();
  const future = (d) => new Date(now + d * 86400000).toISOString();
  t.seedEvent({ type: "appointment", occurredAt: future(2),
    data: { title: "OB checkup", questions: [
      { id: "q1", text: "Ask about vitamins", state: "to_ask" },
      { id: "q2", text: "Ask about kick counts", state: "deferred" },
      { id: "q3", text: "Old question", state: "dismissed" },
    ] } });
  t.seedEvent({ type: "milestone", occurredAt: new Date(now).toISOString(),
    data: { title: "First kicks" } });
  return "seeded";
})()
"""

STOP_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.stopPregnancy();
  return "stopped";
})()
"""

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/nurture/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/nurture/"):]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    # SPA fallback: unknown paths serve index.html
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    with open(fpath, "rb") as f:
        body = f.read()
    route.fulfill(status=200, body=body,
                  content_type=ctype or "application/octet-stream")


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")  # full build; headless-shell artifact unavailable
        ctx = browser.new_context(viewport={"width": 390, "height": 844})  # phone-size: the real surface
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, timeout=30000)
        try:
            page.get_by_test_id("home-screen").wait_for(timeout=30000)
            check("boot: home-screen renders", True)
        except Exception:
            check("boot: home-screen renders", False)

        seed = page.evaluate(SEED_JS)
        check("test hooks seeded", seed == "seeded")
        # Fresh render with hooks intact (goto, not reload — keeps ?testhooks=1)
        page.goto(BASE)
        page.get_by_test_id("home-screen").wait_for(timeout=30000)
        page.wait_for_timeout(2500)

        # Track 2: Visit prep card
        check("v12: visit-prep card renders",
              page.get_by_test_id("home-visit-prep").count() > 0)
        body = page.evaluate("() => document.body.innerText")
        check("v12: visit-prep shows 2 non-dismissed questions",
              "2 questions waiting in your inbox" in body)
        check("v12: visit-prep names the appointment",
              "OB checkup" in body)

        # Track 2: Milestone celebrated card
        check("v12: milestone-celebrated card renders",
              page.get_by_test_id("home-milestone-celebrated").count() > 0)
        body2 = page.evaluate("() => document.body.innerText")
        check("v12: celebrated copy present",
              "saved to your story" in body2 and "First kicks" in body2)

        # Track 1 end-to-end: composer -> save -> proposal -> When? row ->
        # pick date -> save proposal -> visit-prep on Home.
        page.evaluate("() => window.__nurtureTest.clearEvents()")
        page.get_by_role("tab", name="Logs").click()
        page.get_by_test_id("logs-screen").wait_for(timeout=10000)
        field = page.get_by_role("textbox", name="Save a moment")
        field.click()
        field.fill("ultrasound appointment next week")
        page.get_by_role("button", name="Save moment").click()
        try:
            page.get_by_text("Save as appointment?", exact=False).first.wait_for(timeout=8000)
            check("4.5: 'Save as appointment?' proposal offered", True)
        except Exception:
            check("4.5: 'Save as appointment?' proposal offered", False)
        try:
            page.get_by_text("When?", exact=True).first.wait_for(timeout=5000)
            check("4.5: 'When?' date row renders in proposal", True)
        except Exception:
            check("4.5: 'When?' date row renders in proposal", False)
        picker = page.get_by_test_id("appointment-date-picker")
        check("4.5: date picker present", picker.count() > 0)
        if picker.count() > 0:
            two_days = (datetime.date.today() +
                        datetime.timedelta(days=2)).isoformat()
            picker.fill(two_days)
            page.wait_for_timeout(500)
            check("4.5: date picker accepts a future date",
                  picker.input_value() == two_days)
        page.get_by_role("button", name="Save: Save as appointment?").click()
        page.wait_for_timeout(1500)
        # The picked date (2 days out) must drive the visit-prep card on Home.
        page.goto(BASE)
        page.get_by_test_id("home-screen").wait_for(timeout=30000)
        page.wait_for_timeout(2500)
        check("4.5: picked date drives visit-prep on Home",
              page.get_by_test_id("home-visit-prep").count() > 0)

        # Epic 9 C3: stop-state suppresses both v1.2 cards
        stopped = page.evaluate(STOP_JS)
        check("stop-state seeded", stopped == "stopped")
        page.goto(BASE)
        page.get_by_test_id("home-screen").wait_for(timeout=30000)
        page.wait_for_timeout(2500)
        check("C3: visit-prep suppressed after stop",
              page.get_by_test_id("home-visit-prep").count() == 0)
        check("C3: milestone-celebrated suppressed after stop",
              page.get_by_test_id("home-milestone-celebrated").count() == 0)

        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors[:5]:
                print("  pageerror:", e[:200])

        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\n=== v1.2 interactive: {len(results)-len(failed)}/{len(results)} passed ===")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
