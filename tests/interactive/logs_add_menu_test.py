#!/usr/bin/env python3
"""
Interactive test: Logs-tab Add button (Anuraj-approved Sept 2026).

The circular + button REPLACES the old "Save a moment..." composer bar on
the Logs tab. Tap -> light scrim + three pills (Appointment / Add report /
Log entry). Tap x, the scrim, or any pill to fold the menu away.

Run:  python3 tests/interactive/logs_add_menu_test.py [--keep-open]
Must stay green before any push that touches the Logs tab.

Flows:
  A. menu open/close: button label Add <-> Close add menu; close via x and
     via the scrim; old composer bar is gone.
  B. Appointment: fill the intake sheet, save -> the app navigates to the
     Plan tab's ?appointment=<id> detail; the event also lands in the
     timeline (onSaved still fires).
  C. Add report: Choose file -> upload row ends in a check, Done toasts and
     closes (file selection stubbed at the test boundary via filechooser).
  D. Log entry: the real composer floats above a light scrim (no sheet
     chrome, mood pill hidden, photo-only [+]).
     - text -> ink send arrow -> "Saved to your story" toast, settles away
     - photo-only -> blush mic shown, tapping it saves
     - dictation -> transcript lands in the field (FakeSpeechRecognition)
  E. zero page errors throughout.
"""
import mimetypes
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voice_browser_test import FAKE_SR_JS  # noqa: E402

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

REPORT_PDF = "/tmp/willow-test-report.pdf"
PHOTO_PNG = "/tmp/willow-test-photo.png"


def make_fixtures():
    with open(REPORT_PDF, "wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n")
    # Minimal 1x1 PNG.
    import base64
    with open(PHOTO_PNG, "wb") as f:
        f.write(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9Q"
            "DwADhgGAWjR9awAAAABJRU5ErkJggg=="))


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


def main():
    failures = []
    page_errors = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    make_fixtures()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(FAKE_SR_JS)
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(BASE, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        page.evaluate(
            "() => { const t = window.__nurtureTest; "
            "t.completeOnboarding(); t.clearEvents(); "
            "t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }"
        )
        page.goto(LOGS, timeout=30000)
        try:
            page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        except Exception:
            check("logs screen boots", False)
            browser.close()
            sys.exit(1)
        check("logs screen boots", True)

        add_btn = page.get_by_test_id("logs-add-button")
        try:
            add_btn.wait_for(timeout=10000)
        except Exception:
            check("add button renders", False)
        else:
            check("add button renders", True)
        check("add button labeled Add when closed",
              add_btn.get_attribute("aria-label") == "Add")
        check("old composer bar is gone",
              page.get_by_role("textbox", name="Save a moment").count() == 0)
        # + button: 72px floating over the feed (Anuraj Sept 2026 — the old
        # ~110px button ate too much feed); no container box around it.
        box = add_btn.bounding_box()
        check("add button is 72px", box is not None
              and abs(box["width"] - 72) <= 2 and abs(box["height"] - 72) <= 2)
        bar_bg = page.evaluate(
            "() => { const el = document.querySelector('[data-testid=\"logs-add-button\"]').parentElement;"
            " const cs = getComputedStyle(el);"
            " return cs.backgroundColor + '|' + cs.position; }")
        check("add button floats (absolute, transparent wrapper)",
              bar_bg.endswith("|absolute") and bar_bg.startswith("rgba(0, 0, 0, 0)"))

        # ---- A. menu open/close ----
        add_btn.click()
        try:
            page.get_by_test_id("add-menu").wait_for(timeout=5000)
        except Exception:
            check("menu opens on tap", False)
        else:
            check("menu opens on tap", True)
        check("three pills render",
              page.get_by_test_id("add-menu-pill-appointment").count() == 1
              and page.get_by_test_id("add-menu-pill-report").count() == 1
              and page.get_by_test_id("add-menu-pill-log").count() == 1)
        check("button labeled Close add menu when open",
              add_btn.get_attribute("aria-label") == "Close add menu")
        # Close via the x (the same button).
        add_btn.click()
        page.wait_for_timeout(400)
        check("menu closes via x", page.get_by_test_id("add-menu").count() == 0)
        check("button labeled Add after close",
              add_btn.get_attribute("aria-label") == "Add")
        # Close via the scrim (tap a clear spot above the fanned pills —
        # the pills are large per the mockup and cover the screen center).
        add_btn.click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-scrim").click(position={"x": 195, "y": 100})
        page.wait_for_timeout(400)
        check("menu closes via scrim", page.get_by_test_id("add-menu").count() == 0)

        # ---- B. Appointment ----
        add_btn.click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-appointment").click()
        try:
            page.get_by_test_id("appointment-sheet").wait_for(timeout=5000)
        except Exception:
            check("appointment sheet opens", False)
        else:
            check("appointment sheet opens", True)
        page.get_by_test_id("appointment-what").fill("Growth scan")
        page.get_by_test_id("appointment-where").fill("Dr. Izu")
        page.get_by_test_id("appointment-time").fill("14:30")
        page.get_by_test_id("appointment-save").click()
        page.wait_for_timeout(500)
        check("appointment sheet closes after save",
              page.get_by_test_id("appointment-sheet").count() == 0)
        # Saving navigates to the appointment's Plan detail — Anuraj's "it
        # lands in Plan" requirement; the app itself pushes the route now.
        try:
            page.get_by_test_id("appointment-detail").wait_for(timeout=10000)
        except Exception:
            check("appointment opens in Plan detail after save", False,
                  "appointment-detail never appeared")
        else:
            body = page.evaluate("document.body.innerText")
            # The existing Plan detail shows when/where (not the title —
            # pre-existing Epic 6 behavior); the where proves the saved
            # appointment is the one Plan opened.
            check("appointment opens in Plan detail after save", "Dr. Izu" in body)
        event_id = page.evaluate(
            "() => new URL(window.location.href).searchParams.get('appointment')")
        check("appointment event id found", bool(event_id), f"id={event_id}")
        # Back to Logs: onSaved still fired, so the event is in the timeline.
        page.goto(LOGS, timeout=30000)
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        try:
            page.get_by_text("Growth scan").first.wait_for(timeout=8000)
        except Exception:
            check("appointment lands in timeline", False)
        else:
            check("appointment lands in timeline", True)

        # ---- C. Add report ----
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-report").click()
        try:
            page.get_by_test_id("report-sheet").wait_for(timeout=5000)
        except Exception:
            check("report sheet opens", False)
        else:
            check("report sheet opens", True)
        check("choose file + scan document offered",
              page.get_by_test_id("report-choose-file").count() == 1
              and page.get_by_test_id("report-scan").count() == 1)
        with page.expect_file_chooser() as fc:
            page.get_by_test_id("report-choose-file").click()
        fc.value.set_files(REPORT_PDF)
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"report-row-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report upload row appears", False)
        else:
            check("report upload row appears", True)
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"report-done-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report row ends in a check", False)
        else:
            check("report row ends in a check", True)
        page.get_by_test_id("report-done").click()
        try:
            page.get_by_test_id("report-toast").wait_for(timeout=5000)
        except Exception:
            check("report done toasts", False)
        else:
            check("report done toasts", True)
        page.wait_for_timeout(2000)
        check("report sheet closes after done",
              page.get_by_test_id("report-sheet").count() == 0)
        # Entry-typing rule (Anuraj Sept 2026): Add report -> ALWAYS a
        # Report entry, never a generic FILE chip.
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"event-card-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report lands in timeline", False)
        else:
            check("report lands in timeline", True)
            # Find the report's own card by its attachment name (card order
            # is time-dependent — a same-day appointment can sort above it).
            report_card = page.locator(
                '[data-testid^="event-card-"]',
                has_text="willow-test-report.pdf",
            ).first
            try:
                report_card.wait_for(timeout=8000)
            except Exception:
                check("report card found", False)
            else:
                check("report card found", True)
                first_card = report_card.inner_text()
                check("report renders as REPORT chip (not FILE)",
                      "REPORT" in first_card and "FILE" not in first_card)

        # ---- D. Log entry: floating composer ----
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        try:
            page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        except Exception:
            check("log entry floats the composer", False)
        else:
            check("log entry floats the composer", True)
        check("no sheet chrome / no title",
              page.get_by_test_id("appointment-sheet").count() == 0
              and "Log entry" not in page.evaluate("document.body.innerText"))
        check("mood pill hidden",
              "How are you feeling?" not in page.evaluate("document.body.innerText"))
        field = page.get_by_role("textbox", name="Save a moment")
        check("composer field renders", field.count() == 1)

        # [+] offers photos only.
        page.get_by_role("button", name="Add photo").click()
        try:
            page.wait_for_function(
                "() => document.body.innerText.includes('Add a photo')", timeout=5000)
        except Exception:
            check("photo sheet opens with photo title", False)
        else:
            check("photo sheet opens with photo title", True)
        sheet_text = page.evaluate("document.body.innerText")
        check("photo sheet offers take a photo + library",
              "Take a photo" in sheet_text and "Photo library" in sheet_text)
        check("photo sheet has no files option", "Add files" not in sheet_text)
        page.get_by_role("button", name="Dismiss", exact=True).click()
        page.wait_for_timeout(500)

        # Text -> ink send arrow -> toast -> settles away.
        field.fill("Hello little one")
        send_btn = page.get_by_role("button", name="Save moment")
        try:
            send_btn.wait_for(timeout=5000)
        except Exception:
            check("text send state (Save moment)", False)
        else:
            check("text send state (Save moment)", True)
        send_btn.click()
        try:
            page.get_by_test_id("floating-composer-toast").wait_for(timeout=8000)
        except Exception:
            check("save toasts 'Saved to your story'", False)
        else:
            toast_text = page.get_by_test_id("floating-composer-toast").inner_text()
            check("save toasts 'Saved to your story'", "Saved to your story" in toast_text,
                  f"toast={toast_text!r}")
        page.wait_for_timeout(3000)
        check("composer settles away after save",
              page.get_by_test_id("floating-composer").count() == 0)
        check("saved text lands in timeline",
              page.get_by_text("Hello little one").count() >= 1)

        # Photo-only -> blush mic shown, tapping it saves.
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        page.get_by_role("button", name="Add photo").click()
        page.wait_for_function(
            "() => document.body.innerText.includes('Photo library')", timeout=5000)
        with page.expect_file_chooser() as fc2:
            page.get_by_role("button", name="Photo library").click()
        fc2.value.set_files(PHOTO_PNG)
        try:
            page.get_by_role("button", name="Remove willow-test-photo.png").wait_for(timeout=10000)
        except Exception:
            check("photo chip appears", False)
        else:
            check("photo chip appears", True)
        mic_btn = page.get_by_role("button", name="Dictate a moment")
        check("photo-only shows the mic (not send)", mic_btn.count() == 1)
        mic_btn.click()
        try:
            page.get_by_test_id("floating-composer-toast").wait_for(timeout=8000)
        except Exception:
            check("photo-only mic tap saves", False)
        else:
            check("photo-only mic tap saves", True)
        page.wait_for_timeout(3000)
        check("composer settles away after photo save",
              page.get_by_test_id("floating-composer").count() == 0)

        # Dictation -> transcript enters the field for review.
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        page.get_by_role("button", name="Dictate a moment").click()
        try:
            page.get_by_role("button", name="Stop dictation").wait_for(timeout=8000)
        except Exception:
            check("dictation listening UI appears", False)
        else:
            check("dictation listening UI appears", True)
        page.wait_for_timeout(400)
        page.evaluate("window.__srDriver.emitInterim('dreaming of tiny socks')")
        page.wait_for_timeout(400)
        field2 = page.get_by_role("textbox", name="Save a moment")
        field_val = field2.input_value() or ""
        check("dictation transcript lands in field", "tiny socks" in field_val,
              f"field={field_val!r}")
        page.get_by_role("button", name="Stop dictation").click()
        page.wait_for_timeout(3500)  # > stop grace + restart window
        field_val2 = field2.input_value() or ""
        check("transcript kept after stop", len(field_val2.strip()) > 0,
              f"field={field_val2!r}")
        try:
            page.get_by_role("button", name="Save moment").wait_for(timeout=10000)
        except Exception:
            check("send returns after dictation", False)
        else:
            check("send returns after dictation", True)
            page.get_by_role("button", name="Save moment").click()
            try:
                page.get_by_test_id("floating-composer-toast").wait_for(timeout=8000)
            except Exception:
                check("dictated entry saves", False)
            else:
                check("dictated entry saves", True)

        # ---- E. zero page errors ----
        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl+C to exit")
            while True:
                time.sleep(3600)
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nlogs_add_menu: all green")


if __name__ == "__main__":
    main()
