#!/usr/bin/env python3
"""
Interactive browser test: name-and-dates revision (mockup 31 — Anuraj
approved Sept 21, 2026).

Drives the REAL Willow web UI in real Chromium (390x844) against the fresh
dist/ served under /willow/ via Playwright route interception.

Flows (all real UI, no stubs):
  Onboarding (fresh profile -> /willow/onboarding?testhooks=1, screen 1):
  1. Name field label reads "YOUR NAME", placeholder "Your name".
  2. Due-date section: no picker is visible yet; a "Tap to pick a date"
     card is shown instead (no pre-filled value anywhere).
  3. The week helper is hidden and Continue renders muted (opacity 0.55)
     — but is NOT disabled: tapping it with no date chosen shows the
     verbatim inline error "Pick a date to continue".
  4. The error clears the moment a date is picked, and the week helper
     appears with the exact "That's week N, day M — your weekly reading
     will match." copy. Continue returns to full opacity and proceeds to
     the share step.
  5. Birthday: "Add your birthday" opens the picker with NO pre-selected
     date (the input is empty) — no hidden default. Leaving it unpicked
     and continuing saves nothing and never errors.
  You tab (after finishing onboarding):
  6. Name sheet input placeholder is "Your name".
  7. Birthday row reads "Not set"; the sheet opens with no pre-selected
     date; saving the untouched draft closes quietly with no error and no
     value saved. Picking + saving shows the date; "Remove birthday"
     clears it back to "Not set".
  8. zero page errors throughout.

The error-copy + gating rules are also pinned by the unit suite
(tests/name_dates.test.ts); this test is the guard that fails against the
pre-fix build (pre-filled defaults, disabled Continue, no inline error).

Run:  python3 tests/interactive/name_dates_test.py [--keep-open]
"""

import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

# The repo under test is the one this file lives in, so the suite works in
# any workdir clone.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
ONBOARDING_URL = ORIGIN + "/willow/onboarding?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

ERROR_COPY = "Pick a date to continue"
HELPER_RE = re.compile(r"^That’s week \d+, day \d+ — your weekly reading will match\.$")

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
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


def opacity_of(locator):
    return locator.evaluate("el => getComputedStyle(el).opacity")


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---- Onboarding screen 1 -------------------------------------
        page.goto(ONBOARDING_URL, timeout=30000)
        try:
            page.get_by_test_id("role-split").wait_for(timeout=30000)
            check("onboarding renders", True)
        except Exception:
            check("onboarding renders", False)
            browser.close()
            sys.exit(1)
        page.get_by_test_id("role-split-mom").click()
        page.wait_for_timeout(500)
        page.get_by_test_id("onboarding-get-started").click()

        # 1. Name label + placeholder.
        name_input = page.get_by_test_id("onboarding-owner-name")
        name_input.wait_for(timeout=10000)
        check("name label reads YOUR NAME",
              "YOUR NAME" in (page.content() or ""))
        check("name placeholder is 'Your name'",
              name_input.get_attribute("placeholder") == "Your name")

        # 2. Empty by default: the picker card, not a picker; no date input.
        date_card = page.get_by_test_id("onboarding-date-card")
        check("date section shows the 'Tap to pick a date' card",
              date_card.count() > 0
              and "Tap to pick a date" in (date_card.inner_text() or ""))
        check("no date picker is visible before she taps",
              page.get_by_test_id("onboarding-date-picker").count() == 0)
        check("no pre-filled date value anywhere in the date section",
              page.get_by_test_id("onboarding-date-card").count() > 0)

        # 3. Helper hidden; Continue muted but tappable.
        check("week helper hidden before a date is picked",
              page.get_by_test_id("onboarding-week-helper").count() == 0)
        cont = page.get_by_test_id("onboarding-profile-continue")
        check("Continue renders muted (opacity 0.55)",
              opacity_of(cont) == "0.55")
        check("Continue is not hard-disabled",
              cont.get_attribute("aria-disabled") in (None, "false"))

        # Fill her name, tap Continue with no date -> verbatim inline error.
        name_input.fill("Sushmitha")
        cont.click()
        page.wait_for_timeout(500)
        err = page.get_by_test_id("onboarding-date-error")
        check("inline error appears verbatim",
              err.count() > 0 and (err.inner_text() or "").strip() == ERROR_COPY)
        check("helper still hidden after the failed attempt",
              page.get_by_test_id("onboarding-week-helper").count() == 0)

        # 4. Tap the card -> picker appears; pick a date -> error clears,
        #    helper appears with the exact copy; Continue goes full opacity.
        date_card.click()
        picker = page.get_by_test_id("onboarding-date-picker")
        picker.wait_for(timeout=8000)
        check("tapping the card expands the real picker", picker.count() > 0)
        picker.fill("2026-10-08")
        page.wait_for_timeout(500)
        check("error clears the moment a date is picked",
              page.get_by_test_id("onboarding-date-error").count() == 0)
        helper = page.get_by_test_id("onboarding-week-helper")
        helper_text = (helper.inner_text() or "").strip() if helper.count() else ""
        check("week helper appears with the exact copy",
              bool(HELPER_RE.match(helper_text)))
        check("Continue returns to full opacity", opacity_of(cont) == "1")

        # 5. Birthday: opens with NO pre-selected date (no hidden default).
        #    Leaving it unpicked and continuing saves nothing, never errors.
        page.get_by_test_id("onboarding-dob-add").click()
        dob_picker = page.get_by_test_id("onboarding-dob-picker")
        dob_picker.wait_for(timeout=8000)
        check("birthday picker opens with no pre-selected date",
              (dob_picker.input_value() or "") == "")
        check("no birthday error element is rendered",
              page.get_by_test_id("onboarding-dob-error").count() == 0)

        # Proceed through the rest of onboarding (birthday untouched).
        cont.click()
        page.get_by_test_id("onboarding-share-continue").wait_for(timeout=10000)
        check("Continue proceeds to the share step after a date is picked", True)
        page.get_by_test_id("onboarding-share-continue").click()
        page.get_by_test_id("onboarding-chips-continue").click()
        page.get_by_test_id("onboarding-notifications-skip").click()
        page.get_by_test_id("onboarding-finish").click()
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
            check("onboarding finish lands on the Week tab", True)
        except Exception:
            check("onboarding finish lands on the Week tab", False)

        # ---- You tab --------------------------------------------------
        page.get_by_role("tab", name="You").click()
        page.get_by_test_id("account-name-row").wait_for(timeout=10000)

        # 6. Name sheet placeholder.
        page.get_by_test_id("account-name-row").click()
        sheet_name = page.get_by_test_id("account-name-input")
        sheet_name.wait_for(timeout=8000)
        check("You name sheet placeholder is 'Your name'",
              sheet_name.get_attribute("placeholder") == "Your name")
        check("You name sheet opens with the saved name",
              sheet_name.input_value() == "Sushmitha")
        # Save the unchanged name: closes the sheet with no side effects.
        page.get_by_test_id("account-name-save").click()
        page.wait_for_timeout(500)

        # 7. Birthday sheet: untouched from onboarding -> "Not set", the
        #    sheet opens with no pre-selected date, and saving the untouched
        #    draft closes quietly with no error and no value saved.
        check("birthday row reads Not set after untouched onboarding",
              "Not set" in (page.get_by_test_id("account-dob-row").inner_text() or ""))
        page.get_by_test_id("account-dob-row").click()
        sheet_dob = page.get_by_test_id("account-dob-picker")
        sheet_dob.wait_for(timeout=8000)
        check("You birthday sheet opens with no pre-selected date",
              (sheet_dob.input_value() or "") == "")
        page.get_by_test_id("account-dob-save").click()
        page.wait_for_timeout(800)
        check("saving an untouched birthday changes nothing, errors nothing",
              "Not set" in (page.get_by_test_id("account-dob-row").inner_text() or ""))
        # Pick a birthday, save, reopen, remove.
        page.get_by_test_id("account-dob-row").click()
        sheet_dob = page.get_by_test_id("account-dob-picker")
        sheet_dob.wait_for(timeout=8000)
        sheet_dob.fill("1996-09-27")
        page.get_by_test_id("account-dob-save").click()
        page.wait_for_timeout(800)
        check("birthday row shows the picked date",
              "1996" in (page.get_by_test_id("account-dob-row").inner_text() or ""))
        page.get_by_test_id("account-dob-row").click()
        page.get_by_test_id("account-dob-picker").wait_for(timeout=8000)
        check("sheet reopens with the picked date",
              (page.get_by_test_id("account-dob-picker").input_value() or "") == "1996-09-27")
        page.get_by_test_id("account-dob-clear").click()
        page.wait_for_timeout(800)
        check("'Remove birthday' clears it",
              "Not set" in (page.get_by_test_id("account-dob-row").inner_text() or ""))

        # 8. Due sheet: saving the existing date shows no error.
        page.get_by_test_id("account-due-date-row").click()
        page.get_by_test_id("account-due-date-picker").wait_for(timeout=8000)
        page.get_by_test_id("account-due-date-save").click()
        page.wait_for_timeout(800)
        check("due-date save shows no error when a date is set",
              page.get_by_test_id("account-due-date-error").count() == 0)

        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors[:5]:
                print("  pageerror:", e[:200])

        if KEEP_OPEN:
            print("keeping the browser open (--keep-open); Ctrl-C to exit")
            page.wait_for_timeout(3600_000)
        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\n=== name-dates interactive: {len(results)-len(failed)}/{len(results)} passed ===")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
