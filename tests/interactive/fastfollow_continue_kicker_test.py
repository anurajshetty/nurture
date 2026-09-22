#!/usr/bin/env python3
"""
Fast-follow verification (Anuraj, Sept 21, 2026):
  1. Onboarding share screen: ghost "Skip for now" replaced by a real
     secondary Continue button below "Add a partner"; it advances the wizard.
  2. Feed card header kickers carry no date — "Kick counting", "Log", etc.
     only; day-group labels carry the date.

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/ at 390x844. Zero page errors required.

Run:  python3 tests/interactive/fastfollow_continue_kicker_test.py
"""

import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
SHOTS = os.path.join(REPO, "docs", "verification")
os.makedirs(SHOTS, exist_ok=True)

DAY_WORDS = re.compile(
    r"\b(today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b",
    re.IGNORECASE,
)


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if "?" in rel:
        rel = rel.split("?", 1)[0]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


SEED_JS = r"""
(async () => {
  const t = window.__nurtureTest;
  if (!t) return null;
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = new Date().toISOString();
  const note = await t.seedEvent({
    type: "note", visibility: "shared", occurredAt: now,
    data: { text: "Morning walk — felt great today." },
  });
  const kick = await t.seedEvent({
    type: "kick_session", visibility: "shared", occurredAt: now,
    data: { movements: 10, durationMin: 22 },
  });
  return { note: note.id, kick: kick.id };
})()
"""


def main():
    failures = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL dist/index.html missing — run npm run export:web first")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        page.goto(BASE, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)

        # ---- A. Walk onboarding to the share screen -----------------------
        check("welcome role split renders", page.get_by_test_id("role-split").count() > 0)
        page.get_by_test_id("role-split-mom").click()
        page.wait_for_timeout(400)
        page.get_by_test_id("onboarding-get-started").click()
        page.get_by_test_id("onboarding-owner-name").fill("Priya")
        page.get_by_test_id("onboarding-date-card").click()
        page.get_by_test_id("onboarding-date-picker").fill("2026-10-08")
        page.wait_for_timeout(400)
        page.get_by_test_id("onboarding-profile-continue").click()
        page.wait_for_timeout(600)

        check(
            "share screen headline renders",
            page.get_by_text("Share this journey with your partner?").count() > 0,
        )
        cont = page.get_by_test_id("onboarding-share-continue")
        check("Continue button renders on the share screen", cont.count() == 1)
        if cont.count() == 1:
            check("Continue button says Continue", (cont.inner_text() or "").strip() == "Continue")
            style = page.evaluate(
                """(testID) => {
                  const el = document.querySelector(`[data-testid="${testID}"]`);
                  if (!el) return null;
                  const cs = getComputedStyle(el);
                  const t = el.querySelector('span, div') || el;
                  const ts = getComputedStyle(t);
                  return { bg: cs.backgroundColor, border: cs.borderColor, text: ts.color };
                }""",
                "onboarding-share-continue",
            )
            check("Continue is the secondary/ghost treatment (white bg)", bool(style) and "255, 255, 255" in style["bg"], str(style))
            check("Continue text is coral-deep", bool(style) and "200, 95, 62" in style["text"], str(style))
        check(
            'no "Skip for now" anywhere on the share screen',
            page.get_by_text("Skip for now").count() == 0,
        )
        page.screenshot(path=os.path.join(SHOTS, "fastfollow-onboarding-continue.png"))
        cont.click()
        page.wait_for_timeout(600)
        check(
            "Continue advances to the quick-things screen",
            page.get_by_text("A couple of quick things").count() > 0,
        )

        # ---- Finish onboarding so the feed is reachable -------------------
        page.get_by_test_id("onboarding-baby-name").fill("Wren")
        page.get_by_test_id("onboarding-chips-continue").click()
        page.wait_for_timeout(400)
        page.get_by_test_id("onboarding-notifications-skip").click()
        page.wait_for_timeout(400)
        page.get_by_test_id("onboarding-finish").click()
        page.wait_for_timeout(1200)

        # ---- B. Seed events, check the kickers on the Logs feed -----------
        ids = page.evaluate(SEED_JS)
        check("seeded note + kick session", bool(ids and ids.get("note") and ids.get("kick")), str(ids)[:120])
        if not ids:
            browser.close()
            sys.exit(1)
        page.goto(ORIGIN + "/willow/logs?testhooks=1", timeout=30000)
        try:
            page.get_by_test_id(f'event-card-{ids["note"]}').wait_for(timeout=30000)
            page.get_by_test_id(f'event-card-{ids["kick"]}').wait_for(timeout=30000)
        except Exception:
            check("seeded cards rendered on Logs", False, "card testIDs never appeared")
            browser.close()
            sys.exit(1)

        kickers = page.locator('[data-testid^="event-card-date-"]').all_inner_texts()
        check("kicker elements rendered", len(kickers) > 0)
        for i, k in enumerate(kickers):
            check(f"kicker {i} has no date separator", "·" not in k, k[:80])
            check(f"kicker {i} has no day words", not DAY_WORDS.search(k), k[:80])
        kick_kicker = page.get_by_test_id(f'event-card-date-{ids["kick"]}').inner_text()
        check("kick card kicker reads Kick counting", "kick counting" in kick_kicker.lower(), kick_kicker[:80])
        note_kicker = page.get_by_test_id(f'event-card-date-{ids["note"]}').inner_text()
        check("note card kicker reads Moment (label-only)", "moment" in note_kicker.lower() and "·" not in note_kicker, note_kicker[:80])
        page.get_by_test_id(f'event-card-{ids["kick"]}').screenshot(
            path=os.path.join(SHOTS, "fastfollow-kicker-nodate.png"))
        check("day-group labels still carry the date",
              page.get_by_text("Today", exact=True).count() > 0)

        check("zero page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURE(S)")
        sys.exit(1)
    print("\nAll fast-follow checks passed.")


if __name__ == "__main__":
    main()
