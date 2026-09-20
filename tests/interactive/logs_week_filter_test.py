#!/usr/bin/env python3
"""
Interactive test: Logs week pill = filter (Anuraj-approved Sept 2026),
with day-group feed (Anuraj-approved Sept 20, 2026).

The week pill is a FILTER, not a jump: tapping it opens an inline
dropdown ("All weeks" + Week N, newest first). Selecting a week shows
only that week's DAY GROUPS + entries — the pill never renders as a
divider. "All weeks" shows everything. The pill label always matches
the visible feed.

Dates are derived from the live DOM (not hardcoded), so the suite stays
green as the pregnancy advances.

Run:  python3 tests/interactive/logs_week_filter_test.py [--keep-open]
Must stay green before any push that touches the Logs header or timeline.

Flows:
  1. default: pill reads the current week; feed shows day groups only
     (Today first), no week-band dividers
  2. select an older week -> only that week's day groups + entries
     render; pill label matches
  3. select another week -> content changes to that exact week
  4. All weeks -> every day group returns; pill reads "All weeks"
  5. a week with no entries -> warm empty state; "Back to all weeks"
     restores the full story
  6. zero page errors throughout
"""
import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
LOGS = ORIGIN + "/willow/logs?testhooks=1"

KEEP_OPEN = "--keep-open" in sys.argv

SEED_JS = """
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  // Day groups key on the LOCAL calendar day of createdAt (the story
  // date), so backdate createdAt explicitly — saveEvent stamps "now".
  const now = new Date();
  const at = (daysAgo, h) => {
    const x = new Date(now);
    x.setDate(x.getDate() - daysAgo);
    x.setHours(h === undefined ? 9 : h, 12, 0, 0);
    return x.toISOString();
  };
  // Weeks (relative to today): 0/1 -> current, 8/9 -> -1, 16 -> -2.
  [0, 1, 8, 9, 16].forEach((d, i) => {
    const created = at(d);
    const ev = t.seedEvent({ type: "note", occurredAt: created,
      data: { text: "Moment " + (i + 1) } });
    t.setCreatedAt(ev.id, created);
  });
  return "seeded";
})()
"""

GROUP_TITLES_JS = (
    "() => Array.from(document.querySelectorAll('[data-testid^=\"day-group-\"]'))"
    ".map(g => g.innerText.trim())"
)


# RN web renders textTransform:uppercase as literal uppercase in the DOM.
def norm(t):
    return t.strip().lower()


def week_num_from_option(testid):
    m = re.match(r"week-filter-option-(\d+)$", testid)
    return int(m.group(1)) if m else None


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

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(LOGS, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False)
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        page.evaluate(SEED_JS)
        page.goto(LOGS, timeout=30000)
        try:
            page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        except Exception:
            check("logs screen boots", False)
            browser.close()
            sys.exit(1)
        check("logs screen boots", True)
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid^=\"day-group-\"]').length >= 1",
            timeout=15000)

        def pill_text():
            return page.get_by_test_id("week-jump-button").inner_text()

        def open_dropdown():
            page.get_by_test_id("week-jump-button").click()
            page.get_by_test_id("week-filter-dropdown").wait_for(timeout=5000)

        # ---- 1. default: pill reads the current week; feed is day groups ----
        titles = page.evaluate(GROUP_TITLES_JS)
        check("default renders day groups", len(titles) >= 1, f"titles={titles}")
        check("first day group is Today", titles and norm(titles[0]) == "today",
              f"titles={titles}")
        m = re.match(r"Week (\d+)", pill_text())
        top_week = int(m.group(1)) if m else None
        check("pill defaults to the current week", top_week is not None,
              f"pill={pill_text()!r}")
        check("no week-band dividers render by default",
              page.locator('[data-testid^="week-band-"]').count() == 0)
        check("default feed shows only the current week's day groups",
              len(titles) == 2, f"titles={titles}")

        # Switch to All weeks to learn the real filter weeks from the DOM.
        open_dropdown()
        check("dropdown lists All weeks + weeks",
              page.get_by_test_id("week-filter-option-all").count() == 1
              and page.get_by_test_id("week-filter-dropdown").count() == 1)
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(700)
        all_titles = page.evaluate(GROUP_TITLES_JS)
        check("All weeks shows the seeded day groups", len(all_titles) == 5,
              f"titles={all_titles}")
        # Learn the real filter weeks from the dropdown options (internal
        # completed numbers on the testIDs; display labels shown to users).
        open_dropdown()
        option_ids = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"week-filter-option-\"]'))"
            ".map(o => o.getAttribute('data-testid'))")
        option_weeks = sorted(
            (w for w in (week_num_from_option(t) for t in option_ids) if w is not None),
            reverse=True)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        # Escape is not handled by the dropdown; toggle it closed via the
        # pill if it is still open.
        if page.get_by_test_id("week-filter-dropdown").count() > 0:
            page.get_by_test_id("week-jump-button").click()
            page.wait_for_timeout(400)
        # Seeds span 3 completed weeks: current, -1, -2 (top three options).
        check("three seeded weeks in the dropdown", len(option_weeks) >= 3,
              f"options={option_ids[:6]}")
        seeded_weeks = option_weeks[:3]

        # ---- 2. filter to the middle week ----
        # Option testIDs carry the INTERNAL completed-week number while
        # labels show the display week (completed + 1), so select by the
        # visible label — what a real user taps.
        target = seeded_weeks[1]
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {target + 1}", exact=True).click()
        page.wait_for_timeout(700)
        check("picking a week closes the dropdown",
              page.get_by_test_id("week-filter-dropdown").count() == 0)
        titles = page.evaluate(GROUP_TITLES_JS)
        # Seeds at 8 and 9 days ago fall in the middle completed week, on
        # two distinct local days — derive the titles from the DOM, not
        # the clock (the suite must stay green across timezones).
        check("filtered feed shows only that week's day groups",
              len(titles) == 2 and all(norm(t) != "today" for t in titles),
              f"titles={titles}")
        check("pill label matches the filter",
              f"Week {target + 1}" in pill_text(), f"pill={pill_text()!r}")
        check("no week-band divider under the filter",
              page.locator('[data-testid^="week-band-"]').count() == 0)

        # ---- 3. pick another week -> content changes to that exact week ----
        target2 = seeded_weeks[2]
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {target2 + 1}", exact=True).click()
        page.wait_for_timeout(700)
        titles = page.evaluate(GROUP_TITLES_JS)
        check("second pick shows exactly that week",
              len(titles) == 1, f"titles={titles}")
        check("pill follows the second pick",
              f"Week {target2 + 1}" in pill_text(), f"pill={pill_text()!r}")

        # ---- 4. All weeks restores everything ----
        open_dropdown()
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(700)
        titles = page.evaluate(GROUP_TITLES_JS)
        check("All weeks restores every day group", len(titles) == 5, f"titles={titles}")
        check("pill reads All weeks", "All weeks" in pill_text(), f"pill={pill_text()!r}")

        # ---- 5. a week with no entries -> warm empty state ----
        # Seeds span only 3 weeks, so 5 below the top is guaranteed empty.
        empty_w = seeded_weeks[0] - 5
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {empty_w + 1}", exact=True).click()
        page.wait_for_timeout(700)
        empty = page.get_by_test_id("week-empty-state")
        check("empty week shows the warm empty state", empty.count() == 1)
        check("empty state names the week",
              f"Week {empty_w + 1}" in empty.inner_text())
        check("no day groups render for the empty week",
              page.locator('[data-testid^="day-group-"]').count() == 0)
        page.get_by_test_id("week-empty-back").click()
        page.wait_for_timeout(700)
        titles = page.evaluate(GROUP_TITLES_JS)
        check("Back to all weeks restores the story",
              len(titles) == 5 and "All weeks" in pill_text(), f"titles={titles}")

        # ---- 6. zero page errors ----
        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    import time
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        sys.exit(1)
    print("ALL WEEK-FILTER TESTS PASSED")


if __name__ == "__main__":
    main()
