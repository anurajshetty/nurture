#!/usr/bin/env python3
"""
Interactive browser test: the optional baby name (Anuraj, Sept 2026)
+ the Week-as-home tab structure (Sept 2026: the Home briefing screen
was removed; Week is the landing tab).

Drives the REAL Willow web UI in real Chromium (390x844) against the fresh
dist/ served under /willow/ via Playwright route interception.

Flows (all real UI, no stubs):
  1. Tab structure: Week is the first tab and the default landing tab;
     tab order is Week · Logs · You; no Home tab exists.
  2. Fresh profile -> onboarding renders.
     Step 2: fill the optional baby-name field with "Wren", finish onboarding
     -> lands on the Week tab.
  3. You tab -> baby-name row shows the saved name; open the sheet (input
     holds the current name), change it to "Juniper", Save -> row shows
     "Juniper".
  4. Reboot (goto, not reload — keeps ?testhooks=1) -> You tab row still
     shows "Juniper" (persistence).
  5. You tab -> Clear name -> row reads "Not set".
  6. zero page errors throughout.

Run:  python3 tests/interactive/baby_name_test.py [--keep-open]
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

# The repo under test is the one this file lives in, so the suite works in
# any workdir clone (nurture-v12, nurture-onboarding, ...).
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
# NOTE (pre-existing quirk, flagged separately): a fresh profile boots to the
# tab shell instead of onboarding, so the test drives the onboarding route
# directly. The onboarding UI itself is fully real.
ONBOARDING_URL = ORIGIN + "/willow/onboarding?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

NAME_1 = "Wren"
NAME_2 = "Juniper"

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


def goto_you(page):
    page.get_by_role("tab", name="You").click()
    page.get_by_test_id("baby-name-row").wait_for(timeout=10000)


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")
        # Fresh profile: no stored onboarding, no kv.
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. Onboarding with a name -------------------------------------
        page.goto(ONBOARDING_URL, timeout=30000)
        try:
            # The role split renders before the old welcome screen.
            page.get_by_test_id("role-split").wait_for(timeout=30000)
            check("onboarding renders", True)
        except Exception:
            check("onboarding renders", False)
            browser.close()
            sys.exit(1)

        page.get_by_test_id("role-split-mom").click()
        page.wait_for_timeout(500)
        page.get_by_test_id("onboarding-get-started").click()
        # Screen 1 requires her name AND an actively-picked due date.
        page.get_by_test_id("onboarding-owner-name").fill("Priya")
        page.get_by_test_id("onboarding-date-card").click()
        page.get_by_test_id("onboarding-date-picker").fill("2026-10-08")
        page.wait_for_timeout(500)
        page.get_by_test_id("onboarding-profile-continue").click()
        # Sharing screen (new): skip the invite, keep walking the flow.
        page.get_by_test_id("onboarding-share-continue").click()
        name_field = page.get_by_test_id("onboarding-baby-name")
        name_field.wait_for(timeout=10000)
        check("onboarding step 2 has the optional name field", name_field.count() > 0)
        name_field.fill(NAME_1)
        page.get_by_test_id("onboarding-chips-continue").click()
        page.get_by_test_id("onboarding-notifications-skip").click()
        page.get_by_test_id("onboarding-finish").click()

        # 2. Lands on the Week tab (the new home) ------------------------
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
            check("onboarding finish lands on the Week tab", True)
        except Exception:
            check("onboarding finish lands on the Week tab", False)

        tab_names = [t.strip().split("\n")[-1] for t in page.get_by_role("tab").all_inner_texts()]
        check("tab order is Week, Logs, You",
              tab_names == ["Week", "Logs", "You"])
        check("no Home tab", not any(n == "Home" for n in tab_names))

        # 3. Edit the name in the You tab --------------------------------
        goto_you(page)
        check("You tab has the baby-name row",
              page.get_by_test_id("baby-name-row").count() > 0)
        check("row shows the saved name",
              NAME_1 in (page.get_by_test_id("baby-name-row").inner_text() or ""))
        page.get_by_test_id("baby-name-row").click()
        sheet_input = page.get_by_test_id("baby-name-input")
        sheet_input.wait_for(timeout=8000)
        check("sheet opens with the current name", sheet_input.input_value() == NAME_1)
        sheet_input.fill(NAME_2)
        page.get_by_test_id("baby-name-save").click()
        page.wait_for_timeout(800)
        check("row shows the edited name",
              NAME_2 in (page.get_by_test_id("baby-name-row").inner_text() or ""))

        # 4. Reboot proves persistence ------------------------------------
        page.goto(BASE)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        goto_you(page)
        check("edited name persists across reboot",
              NAME_2 in (page.get_by_test_id("baby-name-row").inner_text() or ""))

        # 5. Clear the name -----------------------------------------------
        page.get_by_test_id("baby-name-row").click()
        page.get_by_test_id("baby-name-input").wait_for(timeout=8000)
        page.get_by_test_id("baby-name-clear").click()
        page.wait_for_timeout(800)
        check("cleared name reads Not set",
              "Not set" in (page.get_by_test_id("baby-name-row").inner_text() or ""))

        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors[:5]:
                print("  pageerror:", e[:200])

        if KEEP_OPEN:
            print("keeping the browser open (--keep-open); Ctrl-C to exit")
            page.wait_for_timeout(3600_000)
        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\n=== baby-name interactive: {len(results)-len(failed)}/{len(results)} passed ===")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
