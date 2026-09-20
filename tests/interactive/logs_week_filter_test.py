#!/usr/bin/env python3
"""
Interactive test: Logs week pill = filter (Anuraj-approved Sept 2026).

The week pill is a FILTER, not a jump: tapping it opens an inline
dropdown ("All weeks" + Week N, newest first). Selecting a week shows
only that week's divider + entries; "All weeks" shows everything. The
pill label always matches the visible feed — this is the regression
suite for the reported bug (pill said Week 37, top divider said
Week 38 · Sep 17–23 with due date 2026-10-08).

Dates are derived from the live DOM (not hardcoded), so the suite stays
green as the pregnancy advances.

Run:  python3 tests/interactive/logs_week_filter_test.py [--keep-open]
Must stay green before any push that touches the Logs header or timeline.

Flows:
  1. default: pill reads the same week as the top divider (unification).
  2. select an older week -> only that week's divider + entries render;
     pill label matches.
  3. select another week -> content changes to that exact week.
  4. All weeks -> every divider returns; pill reads "All weeks".
  5. a week with no entries -> warm empty state; "Back to all weeks"
     restores the full story.
  6. zero page errors throughout.
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
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  // Weeks (relative to today): 0/1 -> current, 8/9 -> -1, 16 -> -2.
  [0, 1, 8, 9, 16].forEach((d, i) => {
    t.seedEvent({ type: "note", occurredAt: iso(d),
      data: { text: "Moment " + (i + 1) } });
  });
  return "seeded";
})()
"""

BAND_TITLES_JS = (
    "() => Array.from(document.querySelectorAll('[data-testid^=\"week-band-\"]'))"
    ".map(b => b.innerText.split('\\n')[0].trim())"
)


def week_num(title):
    m = re.match(r"Week (\d+)$", title)
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
            "() => document.querySelectorAll('[data-testid^=\"week-band-\"]').length >= 1",
            timeout=15000)

        def pill_text():
            return page.get_by_test_id("week-jump-button").inner_text()

        def open_dropdown():
            page.get_by_test_id("week-jump-button").click()
            page.get_by_test_id("week-filter-dropdown").wait_for(timeout=5000)

        # ---- 1. default: pill matches the top divider ----
        # (Dates derive from the live DOM, so the suite stays green as the
        # pregnancy advances and at week boundaries.)
        titles = page.evaluate(BAND_TITLES_JS)
        top = week_num(titles[0]) if titles else None
        check("default renders the current week's band", top is not None, f"titles={titles}")
        check("pill label matches the top divider (the Week-37/38 bug)",
              top is not None and f"Week {top}" in pill_text(), f"pill={pill_text()!r}")
        check("default feed shows only the current week",
              len(titles) >= 1 and all(t == f"Week {top}" for t in titles),
              f"titles={titles}")

        # Switch to All weeks to learn the real divider weeks from the DOM.
        open_dropdown()
        check("dropdown lists All weeks + weeks",
              page.get_by_test_id("week-filter-option-all").count() == 1
              and page.get_by_test_id("week-filter-dropdown").count() == 1)
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(700)
        all_titles = page.evaluate(BAND_TITLES_JS)
        check("All weeks shows the seeded dividers", len(all_titles) == 3, f"titles={all_titles}")
        weeks = [week_num(t) for t in all_titles]
        check("divider weeks are distinct", len(set(weeks)) == 3, f"weeks={weeks}")

        # ---- 2. filter to the middle week ----
        # NOTE (Sept 2026): option testIDs carry the INTERNAL completed-week
        # number while labels show the display week (completed + 1), so
        # select by the visible label — what a real user taps.
        target = weeks[1]
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {target}", exact=True).click()
        page.wait_for_timeout(700)
        check("picking a week closes the dropdown",
              page.get_by_test_id("week-filter-dropdown").count() == 0)
        titles = page.evaluate(BAND_TITLES_JS)
        check("filtered feed shows only that week's divider",
              titles == [f"Week {target}"], f"titles={titles}")
        check("pill label matches the filter",
              f"Week {target}" in pill_text(), f"pill={pill_text()!r}")

        # ---- 3. pick another week -> content changes to that exact week ----
        target2 = weeks[2]
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {target2}", exact=True).click()
        page.wait_for_timeout(700)
        titles = page.evaluate(BAND_TITLES_JS)
        check("second pick shows exactly that week",
              titles == [f"Week {target2}"], f"titles={titles}")
        check("pill follows the second pick",
              f"Week {target2}" in pill_text(), f"pill={pill_text()!r}")

        # ---- 4. All weeks restores everything ----
        open_dropdown()
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(700)
        titles = page.evaluate(BAND_TITLES_JS)
        check("All weeks restores every divider", len(titles) == 3, f"titles={titles}")
        check("pill reads All weeks", "All weeks" in pill_text(), f"pill={pill_text()!r}")

        # ---- 5. a week with no entries -> warm empty state ----
        # Seeds span only 3 weeks, so 5 below the top is guaranteed empty.
        empty_w = weeks[0] - 5
        open_dropdown()
        page.get_by_test_id("week-filter-dropdown").get_by_text(f"Week {empty_w}", exact=True).click()
        page.wait_for_timeout(700)
        empty = page.get_by_test_id("week-empty-state")
        check("empty week shows the warm empty state", empty.count() == 1)
        check("empty state names the week",
              f"Week {empty_w}" in empty.inner_text())
        check("no bands render for the empty week",
              page.locator('[data-testid^="week-band-"]').count() == 0)
        page.get_by_test_id("week-empty-back").click()
        page.wait_for_timeout(700)
        titles = page.evaluate(BAND_TITLES_JS)
        check("Back to all weeks restores the story",
              len(titles) == 3 and "All weeks" in pill_text(), f"titles={titles}")

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
