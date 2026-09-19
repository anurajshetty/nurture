#!/usr/bin/env python3
"""
Standing interactive browser test: Epic 7 partner sharing.

Drives the REAL Nurture web UI in real Chromium against the built dist/
served under /nurture/. Covers the approved 07-partner mockup flows:

  1. journal sheet -> visibility picker (Private/Shared/+Export) with the
     plain-language note updating per state (via the journal-test route)
  2. You tab -> "Partner sharing" row opens the partner sheet
  3. invite flow: invite -> 24h link box -> copy -> owner-confirm gate ->
     active (limitations copy + access history on screen)
  4. preview toggle: partner's view shows only shared entries; a private
     symptom stays invisible; owner's view shows both with badges
  5. revoke flow: warning copy -> confirm -> revoked state; row subtitle
     reflects the revoked state after close

Zero page errors allowed.

Run:  python3 tests/interactive/epic7_partner_browser_test.py [--keep-open]
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/epic7-work")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/nurture/?testhooks=1"
JOURNAL_TEST = ORIGIN + "/nurture/journal-test?testhooks=1"
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
    if not path.startswith("/nurture/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/nurture/"):]
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
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))

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
        check("flow2: row reads not-connected",
              "No one connected yet" in row.inner_text(), f"row={row.inner_text()[:80]!r}")

        row.click()
        psheet = page.get_by_test_id("partner-sheet")
        try:
            psheet.wait_for(timeout=10000)
        except Exception:
            check("flow2: partner sheet opens", False, "partner-sheet never appeared")
            browser.close()
            sys.exit(1)
        check("flow2: partner sheet opens", True)
        body = psheet.inner_text()
        check("flow2: invite intro copy",
              "Share the journey, your way" in body, f"body={body[:120]!r}")

        # ---- Flow 3: invite ----
        page.get_by_test_id("partner-invite-button").click()
        try:
            page.get_by_test_id("partner-link-box").wait_for(timeout=8000)
        except Exception:
            check("flow3: invite link box appears", False, "link box never appeared")
            browser.close()
            sys.exit(1)
        check("flow3: invite link box appears", True)
        link_text = page.get_by_test_id("partner-link-box").inner_text()
        check("flow3: link is a nurture.app join URL",
              "nurture.app/join/" in link_text, f"link={link_text!r}")
        expiry = page.get_by_test_id("partner-invite-expiry").inner_text()
        check("flow3: 24h expiry countdown shown",
              "expires in 23h" in expiry, f"expiry={expiry!r}")

        page.get_by_test_id("partner-copy-button").click()
        page.wait_for_timeout(600)
        toast = page.get_by_test_id("partner-toast")
        toast_text = toast.inner_text() if toast.count() else ""
        check("flow3: copy gives feedback",
              "Link copied" in toast_text or "Long-press" in toast_text,
              f"toast={toast_text!r}")

        # Owner-confirmation gate: nothing shared until confirmed.
        page.get_by_test_id("partner-confirm-join-button").click()
        page.wait_for_timeout(400)
        confirm_body = psheet.inner_text()
        check("flow3: confirm card names the gate",
              "accepted your invite" in confirm_body and "Confirm & start sharing" in confirm_body,
              f"body={confirm_body[:150]!r}")
        page.get_by_test_id("partner-confirm-start-button").click()
        page.wait_for_timeout(600)
        active_body = psheet.inner_text()
        check("flow3: active state shows connected partner",
              "Connected · can see shared moments" in active_body, f"body={active_body[:150]!r}")
        check("flow3: limitations stated on-screen",
              "private health logs" in active_body and "export your record" in active_body,
              "limitations copy missing")
        check("flow3: access history records the invite",
              "Invite sent" in active_body, "invite_sent history row missing")

        # ---- Flow 4: preview toggle ----
        preview_note = page.get_by_test_id("partner-preview-note").inner_text()
        check("flow4: owner preview note",
              "every entry" in preview_note, f"note={preview_note!r}")
        check("flow4: owner sees the private symptom with its badge",
              "Heartburn" in active_body and "Only you" in active_body,
              "owner view missing private entry/badge")

        page.get_by_test_id("partner-preview-toggle").get_by_role("radio", name="Partner’s view").click()
        page.wait_for_timeout(600)
        partner_body = psheet.inner_text()
        check("flow4: partner preview note is exact",
              "exactly what Alex sees" in partner_body, "partner preview note missing")
        check("flow4: partner sees the shared milestone",
              "First strong kicks" in partner_body, "shared milestone missing from partner view")
        check("flow4: partner does NOT see the private symptom",
              "Heartburn" not in partner_body, "private symptom leaked into partner view")
        check("flow4: partner capabilities stated (notes + one Love reaction)",
              "one ❤ Love reaction" in partner_body, "reaction copy missing")

        page.get_by_test_id("partner-preview-toggle").get_by_role("radio", name="Your view").click()
        page.wait_for_timeout(400)

        # ---- Flow 5: revoke ----
        page.get_by_test_id("partner-revoke-button").click()
        page.wait_for_timeout(400)
        revoke_body = psheet.inner_text()
        check("flow5: revoke confirm names the downloaded-content caveat",
              "already saved or downloaded" in revoke_body, "revoke warning missing")
        page.get_by_test_id("partner-revoke-confirm").click()
        page.wait_for_timeout(600)
        revoked_body = psheet.inner_text()
        check("flow5: revoked state is quiet",
              "Access revoked" in revoked_body and "nothing is shared" in revoked_body,
              f"body={revoked_body[:150]!r}")
        check("flow5: invite offered again after revoke",
              page.get_by_test_id("partner-invite-button").count() == 1,
              "invite button missing after revoke")

        # Dismiss the sheet (Escape closes the modal via onRequestClose on web? use backdrop).
        page.keyboard.press("Escape")
        page.wait_for_timeout(1200)
        if page.get_by_test_id("partner-sheet").count():
            # Fallback: tap the row again is impossible while open; click scrim via keyboard nav.
            page.evaluate("document.querySelector('[data-testid=\"partner-sheet\"]')?.parentElement?.click()")
            page.wait_for_timeout(1200)
        row_text = page.get_by_test_id("partner-sharing-row").inner_text()
        check("flow5: row subtitle reflects revoked state",
              "Access revoked" in row_text, f"row={row_text[:80]!r}")

        # ---- Flow 6: stop flag pauses partner sharing (contract C3) ----
        page.evaluate("window.__nurtureTest.stopPregnancy()")
        page.get_by_test_id("partner-sharing-row").click()
        try:
            page.get_by_test_id("partner-sheet").wait_for(timeout=10000)
        except Exception:
            check("flow6: partner sheet reopens after stop", False, "sheet never appeared")
        else:
            check("flow6: partner sheet reopens after stop", True)
            stopped_body = page.get_by_test_id("partner-sheet").inner_text()
            check("flow6: paused note shown when tracking stopped",
                  "Partner sharing is paused" in stopped_body, "stopped note missing")
            invite_btn = page.get_by_test_id("partner-invite-button")
            check("flow6: invite disabled when tracking stopped",
                  invite_btn.get_attribute("disabled") is not None
                  or invite_btn.get_attribute("aria-disabled") == "true",
                  "invite button not disabled")

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
