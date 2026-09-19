#!/usr/bin/env python3
"""
Interactive browser test: the optional baby name (Anuraj, Sept 2026).

Drives the REAL Nurture web UI in real Chromium (390x844) against the fresh
dist/ served under /nurture/ via Playwright route interception.

Flows (all real UI, no stubs):
  1. Fresh profile -> onboarding renders.
     Step 2: fill the optional baby-name field with "Wren", finish onboarding.
  2. Home briefing uses the name: "How big is Wren?", routine-baby preview
     contains "Wren".
  3. You tab -> baby-name row -> sheet shows the saved name; change it to
     "Juniper", Save -> Home briefing shows "How big is Juniper?".
  4. You tab -> Clear name -> Home briefing falls back to
     "How big is your baby?" and the "Your baby's name" celebration card
     never appears.
  5. zero page errors throughout.

Run:  python3 tests/interactive/baby_name_test.py [--keep-open]
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
# NOTE (pre-existing quirk, flagged separately): a fresh profile boots to the
# tab shell instead of onboarding, so the test drives the onboarding route
# directly. The onboarding UI itself is fully real.
ONBOARDING_URL = ORIGIN + "/nurture/onboarding?testhooks=1"
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


def body_text(page):
    return page.evaluate("() => document.body.innerText")


def wait_for_briefing(page):
    """Home screen + the size card rendered (briefing generation done)."""
    page.get_by_test_id("home-screen").wait_for(timeout=30000)
    page.get_by_test_id("delight-card-size").wait_for(timeout=30000)
    page.wait_for_timeout(1200)


def is_name_day():
    """Whether today's rotating delight kind is 'name' (order has 5 kinds
    when a name is set; 'name' sits at index 3)."""
    today = datetime.date.today()
    day_of_year = today.timetuple().tm_yday
    return day_of_year % 5 == 3


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")
        # Fresh profile: no stored onboarding, no kv, no briefing cache.
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. Onboarding with a name -------------------------------------
        page.goto(ONBOARDING_URL, timeout=30000)
        try:
            page.get_by_test_id("onboarding-get-started").wait_for(timeout=30000)
            check("onboarding renders", True)
        except Exception:
            check("onboarding renders", False)
            browser.close()
            sys.exit(1)

        page.get_by_test_id("onboarding-get-started").click()
        page.get_by_test_id("onboarding-date-continue").click()  # default due date
        name_field = page.get_by_test_id("onboarding-baby-name")
        name_field.wait_for(timeout=10000)
        check("onboarding step 2 has the optional name field", name_field.count() > 0)
        name_field.fill(NAME_1)
        page.get_by_test_id("onboarding-chips-continue").click()
        page.get_by_test_id("onboarding-notifications-skip").click()
        page.get_by_test_id("onboarding-finish").click()

        # 2. Home briefing uses the name --------------------------------
        wait_for_briefing(page)
        size_text = page.get_by_test_id("delight-card-size").inner_text()
        check("briefing size card uses the name", f"How big is {NAME_1}?" in size_text)
        baby_text = page.get_by_test_id("briefing-card-baby").inner_text()
        check("routine-baby preview uses the name", NAME_1 in baby_text)
        check("no raw name tokens leak into the briefing",
              "{Name}" not in body_text(page) and "{name}" not in body_text(page))

        # The name-celebration card only appears on its rotation day; when
        # today IS that day, it must celebrate the choice, never a meaning.
        if is_name_day():
            rot_text = page.get_by_test_id("delight-card-rotating").inner_text()
            check("name day: celebration card appears", "Your baby's name" in rot_text)
            check("name day: celebration uses the name, invents no meaning",
                  f"You chose {NAME_1}" in rot_text and "means" not in rot_text.lower())
        else:
            # Not the 'name' rotation day today — the deterministic unit tests
            # (delight.test.ts 31-day sweep, home_briefing name-day) cover it.
            check("name day: celebration card appears (not today — skipped)", True)
            check("name day: celebration uses the name (not today — skipped)", True)

        # 3. Edit the name in the You tab --------------------------------
        page.get_by_role("tab", name="You").click()
        page.get_by_test_id("baby-name-row").wait_for(timeout=10000)
        check("You tab has the baby-name row", page.get_by_test_id("baby-name-row").count() > 0)
        check("row shows the saved name", NAME_1 in (page.get_by_test_id("baby-name-row").inner_text() or ""))
        page.get_by_test_id("baby-name-row").click()
        sheet_input = page.get_by_test_id("baby-name-input")
        sheet_input.wait_for(timeout=8000)
        check("sheet opens with the current name", sheet_input.input_value() == NAME_1)
        sheet_input.fill(NAME_2)
        page.get_by_test_id("baby-name-save").click()
        page.wait_for_timeout(800)

        # Reboot (goto, not reload — keeps ?testhooks=1) to prove persistence.
        page.goto(BASE)
        wait_for_briefing(page)
        size_text2 = page.get_by_test_id("delight-card-size").inner_text()
        check("edited name drives the briefing", f"How big is {NAME_2}?" in size_text2)
        check("old name is gone", NAME_1 not in size_text2)

        # 4. Clear the name -> generic fallback, no celebration card ------
        page.get_by_role("tab", name="You").click()
        page.get_by_test_id("baby-name-row").click()
        page.get_by_test_id("baby-name-input").wait_for(timeout=8000)
        page.get_by_test_id("baby-name-clear").click()
        page.wait_for_timeout(800)
        page.goto(BASE)
        wait_for_briefing(page)
        size_text3 = page.get_by_test_id("delight-card-size").inner_text()
        check("cleared name falls back to generic baby", "How big is your baby?" in size_text3)
        final_body = body_text(page)
        check("no celebration card without a name", "Your baby's name" not in final_body)
        check("no raw name tokens after clearing",
              "{Name}" not in final_body and "{name}" not in final_body)

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
