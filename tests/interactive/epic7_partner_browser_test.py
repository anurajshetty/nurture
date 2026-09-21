#!/usr/bin/env python3
"""Standing interactive browser test: partner sharing (mockup 33).

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/. Covers:

  1. journal sheet -> visibility picker (Private/Shared/+Export) with the
     plain-language note updating per state (via the journal-test route)
  2. You tab -> "Share with your partner" row opens the invite-code sheet
  3. code surface: Copy + Share buttons, graceful degradation when the
     backend migration isn't applied (never a crash)
  4. no reachable old Epic 7 UI: no 24h expiry, no nurture.app/join links,
     no owner-confirm gate, no preview toggle
Zero page errors allowed.

Run:  python3 tests/interactive/epic7_partner_browser_test.py [--keep-open]
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
JOURNAL_TEST = ORIGIN + "/willow/journal-test?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  // One shared keepsake moment (visible to the partner) ...
  t.seedEvent({ type: "milestone", occurredAt: iso(4), visibility: "shared",
    data: { text: "First strong kicks — felt them during dinner." } });
  // ... and one private health log (never visible to the partner).
  t.seedEvent({ type: "symptom", occurredAt: iso(1),
    data: { symptoms: ["Heartburn", "Backache"] } });
  return "seeded";
})()
"""


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
        # SPA fallback: expo-router tab routes have no static file.
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def main():
    failures = []
    page_errors = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        def supabase_stub(route):
            # The backend isn't reachable from the test sandbox; answer API
            # calls with a clean JSON error so no "Failed to load resource"
            # console error is logged. The app degrades gracefully.
            route.fulfill(
                status=404,
                content_type="application/json",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Expose-Headers": "Content-Range",
                },
                body='{"code":"42883","message":"function does not exist"}',
            )

        ctx.route("https://*.supabase.co/**", supabase_stub)
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))

        def _note_console(m):
            # "Failed to load resource" is network outcome (the backend
            # migration isn't applied / the sandbox blocks the API host) —
            # never a JS bug. Uncaught exceptions arrive via pageerror.
            if m.type == "error" and not (m.text or "").startswith("Failed to load resource"):
                page_errors.append(m.text[:200])

        page.on("console", _note_console)

        # ---- Flow 1: visibility picker on the journal sheet ----
        page.goto(JOURNAL_TEST, timeout=30000)
        page.get_by_test_id("journal-test-open").click()
        sheet = page.get_by_test_id("journal-sheet")
        try:
            sheet.wait_for(timeout=15000)
        except Exception:
            check("flow1: journal sheet opens", False, "journal-sheet never appeared")
            browser.close()
            sys.exit(1)
        check("flow1: journal sheet opens", True)

        picker = page.get_by_test_id("journal-visibility")
        check("flow1: visibility picker present", picker.count() == 1)
        note = page.get_by_test_id("journal-visibility-note")
        note_text = note.inner_text()
        check("flow1: default note is the private note",
              "only you" in note_text and "Alex" in note_text, f"note={note_text!r}")

        page.get_by_role("radio", name="👥 Shared").click()
        page.wait_for_timeout(400)
        note_text = note.inner_text()
        check("flow1: shared note explains visit summaries",
              "Shared" in note_text and "visit summaries" in note_text, f"note={note_text!r}")

        page.get_by_role("radio", name="📄 + Export").click()
        page.wait_for_timeout(400)
        note_text = note.inner_text()
        check("flow1: +export note mentions visit summary",
              "visit summary" in note_text, f"note={note_text!r}")

        # Save a note with the +Export visibility; the sheet must close cleanly.
        page.get_by_test_id("journal-text-input").fill("Bump photo day — feeling great.")
        page.get_by_role("radio", name="🔒 Private").click()
        page.wait_for_timeout(300)
        page.get_by_test_id("journal-voice").click()  # send arrow: text present -> saves
        try:
            sheet.wait_for(state="detached", timeout=8000)
            check("flow1: saving closes the sheet", True)
        except Exception:
            check("flow1: saving closes the sheet", False, "sheet stayed open")

        # ---- Flows 2-5: partner section in the You tab ----
        page.goto(BASE, timeout=30000)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        # Fresh context: onboarding isn't done, so complete it via hooks
        # before expecting the tab shell.
        page.evaluate("window.__nurtureTest.completeOnboarding()")
        # The week screen needs a pregnancy row — without one it renders a
        # testID-less empty variant. Seed both, then reload.
        page.evaluate("window.__nurtureTest.seedPregnancy({ dueDate: '2026-12-31' })")
        # The sql.js DB persists to localStorage asynchronously — give the
        # writes a beat before reloading, or they are lost on navigation.
        page.wait_for_timeout(2000)
        page.goto(BASE, timeout=30000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
        except Exception:
            check("app boots to Week", False, "week-screen never appeared")
            browser.close()
            sys.exit(1)
        seed_status = page.evaluate(SEED_JS)
        check("test hooks active and seeded", seed_status == "seeded", f"status={seed_status}")

        page.get_by_role("tab", name="You").click()
        row = page.get_by_test_id("partner-sharing-row")
        try:
            row.wait_for(timeout=15000)
        except Exception:
            check("flow2: partner row present in You tab", False, "row never appeared")
            browser.close()
            sys.exit(1)
        check("flow2: partner row present in You tab", True)
        check("flow2: row reads Share with your partner",
              "Share with your partner" in row.inner_text(), f"row={row.inner_text()[:80]!r}")

        row.click()
        psheet = page.get_by_test_id("partner-sheet")
        try:
            psheet.wait_for(timeout=10000)
        except Exception:
            check("flow2: share-code sheet opens", False, "partner-sheet never appeared")
            browser.close()
            sys.exit(1)
        check("flow2: share-code sheet opens", True)
        body = psheet.inner_text()
        check("flow2: code card labels the invite code",
              "Your invite code" in body, f"body={body[:120]!r}")

        # ---- Flow 3: graceful degradation (backend migration not applied) ----
        check("flow3: backend-not-ready note shown, no crash",
              "getting ready" in body, f"body={body[:160]!r}")
        share_btn = page.get_by_test_id("share-code-share")
        copy_btn = page.get_by_test_id("share-code-copy")
        check("flow3: share button disabled until a code exists",
              share_btn.get_attribute("aria-disabled") == "true", "share not disabled")
        check("flow3: copy button disabled until a code exists",
              copy_btn.get_attribute("aria-disabled") == "true", "copy not disabled")
        check("flow3: remove-partner hidden when not connected",
              page.get_by_test_id("share-code-remove").count() == 0,
              "remove button visible with no partner")

        # ---- Flow 4: no reachable old Epic 7 UI ----
        for old in ("nurture.app/join/", "expires in", "24h", "Confirm & start sharing",
                    "accepted your invite", "Partner\u2019s view"):
            check("flow4: no old UI " + old[:24], old not in body, "old copy leaked: " + old)

        # ---- Flow 5: close the sheet; row subtitle stays sane ----
        page.get_by_test_id("share-code-back").click()
        page.wait_for_timeout(1200)
        check("flow5: sheet closes via back",
              page.get_by_test_id("partner-sheet").count() == 0, "sheet stayed open")
        row_text = page.get_by_test_id("partner-sharing-row").inner_text()
        check("flow5: row subtitle is the not-connected reading",
              "Share your code to link up" in row_text or "Partner sharing" in row_text,
              f"row={row_text[:80]!r}")

        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}" if page_errors else "")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open)")
            page.wait_for_timeout(3600_000)
        browser.close()

    print(f"\n=== epic7 browser: {len(failures)} failures; {len(page_errors)} page errors ===")
    if failures or page_errors:
        sys.exit(1)
    print("ALL GREEN")


if __name__ == "__main__":
    main()
