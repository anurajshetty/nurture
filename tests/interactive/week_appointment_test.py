#!/usr/bin/env python3
"""
Interactive browser test: the upcoming-appointment priority card on the
Week screen (Anuraj, Sept 2026).

Drives the REAL Nurture web UI in real Chromium (390x844) against dist/
served under /nurture/ via Playwright route interception.

Flows (all real UI, no stubs):
  1. Seed an appointment inside the window (tomorrow 10:30 local) ->
     the card renders ABOVE the Highlights section with warm date words
     ("Tomorrow at 10:30 AM") and the headline "A gentle nudge".
  2. Tap the card -> lands on the Plan tab.
  3. Seed a second in-window appointment -> "+1 more" line appears.
  4. Seed an appointment outside the window (day+5) and clear the rest ->
     no card renders.
  5. Seed an in-window appointment but page to a past week -> the card is
     suppressed.
  6. No "{Name}"/"{name}" tokens and no "— or a" comparison phrasing
     anywhere on the Week screen.
  7. Warm greeting: set the baby name in the You tab -> Week greeting
     uses it ("Hey, you're almost there. Any day now, Wren.") and
     highlights resolve tokens; clear the name -> greeting falls back
     to the generic wording.
  8. Zero page errors throughout.

Run:  python3 tests/interactive/week_appointment_test.py [--keep-open]
"""

import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/nurture/?testhooks=1"
WEEK_URL = ORIGIN + "/nurture/week?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

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


SEED_PREGNANCY_JS = """() => {
  const t = window.__nurtureTest;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
}"""


def seed_appointments_js(specs):
    """specs: list of (days_ahead, hour, minute, title)."""
    body = ",".join(
        f"{{days:{d},h:{h},m:{mi},title:{title!r}}}"
        for d, h, mi, title in specs
    )
    return f"""() => {{
  const t = window.__nurtureTest;
  t.clearEvents();
  const now = new Date();
  const out = [];
  [{body}].forEach((s) => {{
    const d = new Date(now);
    d.setDate(d.getDate() + s.days);
    d.setHours(s.h, s.m, 0, 0);
    out.push(t.seedEvent({{
      type: 'appointment',
      occurredAt: d.toISOString(),
      data: {{ title: s.title }},
    }}).id);
  }});
  return JSON.stringify(out);
}}"""


def goto_week(page):
    page.goto(WEEK_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(ORIGIN + "/**", serve_dist)

        print("Boot -> seed pregnancy")
        page.goto(BASE, wait_until="networkidle")
        # Test hooks install after the SQLite WASM DB is ready; wait for them
        # instead of sleeping a fixed amount.
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED_PREGNANCY_JS)
        page.wait_for_timeout(500)

        # --- 1. in-window appointment renders above Highlights -----------
        print("Seeding tomorrow 10:30 appointment")
        page.evaluate(seed_appointments_js([(1, 10, 30, "Growth scan")]))
        goto_week(page)

        card = page.get_by_test_id("week-appointment-card")
        check("card renders for in-window appointment", card.count() == 1)
        if card.count() == 1:
            # The headline renders as an uppercase kicker by design; compare
            # case-insensitively.
            check("card headline is warm (A gentle nudge)",
                  "a gentle nudge" in card.inner_text().lower())
            check("card shows appointment title",
                  "Growth scan" in card.inner_text())
            when = page.get_by_test_id("week-appointment-when").inner_text()
            print(f"    when: {when!r}")
            check("warm date words (Tomorrow at h:MM AM/PM)",
                  re.fullmatch(r"Tomorrow at \d{1,2}:\d{2} (AM|PM)", when) is not None)
            # ordering: card above Highlights
            card_y = card.bounding_box()["y"]
            hl_y = page.get_by_test_id("week-highlights").bounding_box()["y"]
            check("card sits above Highlights section", card_y < hl_y)

            # Screenshot: headline + appointment card at the top of Week.
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(500)
            page.screenshot(path="/tmp/week-appointment-card.png")
            print("    screenshot: /tmp/week-appointment-card.png")

            # --- 2. tap card -> Plan tab ---------------------------------
            print("Tapping the card")
            card.click()
            page.wait_for_timeout(1500)
            check("tap lands on the Plan tab",
                  page.get_by_test_id("plan-screen").count() > 0)

        # --- 3. +N more --------------------------------------------------
        print("Seeding a second in-window appointment")
        page.evaluate(seed_appointments_js([
            (1, 10, 30, "Growth scan"),
            (2, 9, 0, "Birth-plan chat"),
        ]))
        goto_week(page)
        more = page.get_by_test_id("week-appointment-more")
        check("+1 more line appears", more.count() == 1 and
              more.inner_text().strip() == "+1 more")

        # --- 4. outside the window -> no card -----------------------------
        print("Seeding an appointment outside the window (day+5)")
        page.evaluate(seed_appointments_js([(5, 9, 0, "Far-future visit")]))
        goto_week(page)
        check("no card for out-of-window appointment",
              page.get_by_test_id("week-appointment-card").count() == 0)

        # --- 5. past week suppresses the card ----------------------------
        print("Seeding an in-window appointment, then paging back")
        page.evaluate(seed_appointments_js([(1, 15, 0, "Midwife visit")]))
        goto_week(page)
        check("card renders before paging",
              page.get_by_test_id("week-appointment-card").count() == 1)
        page.get_by_test_id("week-prev").click()
        page.wait_for_timeout(1500)
        check("card suppressed on a past week",
              page.get_by_test_id("week-appointment-card").count() == 0)
        page.get_by_test_id("week-back-current").click()
        page.wait_for_timeout(1500)
        check("card returns on the current week",
              page.get_by_test_id("week-appointment-card").count() == 1)

        # --- 6. copy hygiene ----------------------------------------------
        body = page.locator("[data-testid='week-screen']").inner_text()
        check("no {Name}/{name} token leakage",
              "{Name}" not in body and "{name}" not in body)
        check("no '— or a' comparison phrasing", "— or a" not in body)

        # --- 7. warm greeting (name-aware, stage-based) ----------------------
        print("Setting baby name via the You tab")
        page.get_by_role("tab", name="You").click()
        page.get_by_test_id("baby-name-row").wait_for(timeout=10000)
        page.get_by_test_id("baby-name-row").click()
        page.get_by_test_id("baby-name-input").wait_for(timeout=8000)
        page.get_by_test_id("baby-name-input").fill("Wren")
        page.get_by_test_id("baby-name-save").click()
        page.wait_for_timeout(800)
        check("You tab row shows the saved name",
              "Wren" in (page.get_by_test_id("baby-name-row").inner_text() or ""))

        # Back to Week: the greeting picks up the name on focus.
        page.get_by_role("tab", name="Week").click()
        page.get_by_test_id("week-greeting").wait_for(timeout=10000)
        page.wait_for_timeout(1000)
        greeting = page.get_by_test_id("week-greeting").inner_text()
        print(f"    greeting: {greeting!r}")
        check("greeting uses the saved name",
              greeting == "Hey, you're almost there. Any day now, Wren.")
        highlights = page.get_by_test_id("week-highlights").inner_text()
        check("highlights resolve {Name} tokens with the name",
              "Wren" in highlights and "{Name}" not in highlights
              and "{name}" not in highlights)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)
        page.screenshot(path="/tmp/week-greeting.png")
        print("    screenshot: /tmp/week-greeting.png")

        # Clear the name: greeting falls back to warm generic wording.
        page.get_by_role("tab", name="You").click()
        page.get_by_test_id("baby-name-row").wait_for(timeout=10000)
        page.get_by_test_id("baby-name-row").click()
        page.get_by_test_id("baby-name-input").wait_for(timeout=8000)
        page.get_by_test_id("baby-name-clear").click()
        page.wait_for_timeout(800)
        page.get_by_role("tab", name="Week").click()
        page.get_by_test_id("week-greeting").wait_for(timeout=10000)
        page.wait_for_timeout(1000)
        greeting2 = page.get_by_test_id("week-greeting").inner_text()
        print(f"    greeting (cleared): {greeting2!r}")
        check("greeting falls back when no name",
              greeting2 == "Hey, you're almost there.")

        # --- 8. zero page errors ------------------------------------------
        check(f"zero page errors (got {len(errors)})", len(errors) == 0)
        for e in errors[:5]:
            print(f"    pageerror: {e[:160]}")

        if KEEP_OPEN:
            print("keeping browser open (Ctrl-C to exit)")
            page.wait_for_timeout(10**9)
        browser.close()

    failed = [n for n, c in results if not c]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
