#!/usr/bin/env python3
"""
Interactive test: Logs header compaction (Anuraj-approved Sept 2026).

The "Your story" header block (title + week pill + filter chips) was
eating ~40% of the viewport. Per mockup 13-logs-add: 24px title, tighter
week pill, compact 44pt filter chips — the header block lands around
~90-105px so the feed gets meaningfully more room. Also asserts the old
"Save a moment..." composer bar is gone (Replace decision).

Run:  python3 tests/interactive/logs_header_compact_test.py [--keep-open]
Must stay green before any push that touches the Logs header.
"""

import mimetypes
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv


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


SEED_JS = """
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  const now = Date.now();
  const iso = (daysAgo, h) => new Date(now - daysAgo * 86400000 - h * 3600000).toISOString();
  [0, 1, 2, 8, 9].forEach((d, i) => {
    t.seedEvent({ type: "note", occurredAt: iso(d, i),
      data: { text: "Moment " + (i + 1) } });
  });
  return "seeded";
})()
"""


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
            page.get_by_test_id("logs-header").wait_for(timeout=10000)
        except Exception:
            check("logs screen + header boot", False)
            browser.close()
            sys.exit(1)
        check("logs screen + header boot", True)

        # The old always-visible composer bar is gone (Replace decision).
        check("old composer bar is gone",
              page.get_by_role("textbox", name="Save a moment").count() == 0)

        # 24px title per the mockup.
        title = page.get_by_text("Your story", exact=True)
        title_size = title.evaluate(
            "el => getComputedStyle(el).fontSize")
        check("title is 24px", title_size == "24px", f"fontSize={title_size}")

        # Header block (title row + filter chips) lands around ~90-115px.
        header_box = page.get_by_test_id("logs-header").bounding_box()
        filters_box = page.get_by_test_id("timeline-filters").bounding_box()
        if header_box and filters_box:
            block_h = (filters_box["y"] + filters_box["height"]) - header_box["y"]
            check("header block ~90-115px", 85 <= block_h <= 120, f"height={block_h:.0f}px")
        else:
            check("header block measurable", False)

        # Filter chips stay 44pt targets.
        chip = page.get_by_test_id("filter-chip-all")
        chip_box = chip.bounding_box()
        if chip_box:
            check("filter chip is 44pt", 42 <= chip_box["height"] <= 48,
                  f"height={chip_box['height']:.0f}px")
        else:
            check("filter chip renders", False)

        # Week pill keeps its 44pt target.
        pill = page.get_by_test_id("week-jump-button")
        pill_box = pill.bounding_box()
        if pill_box:
            check("week pill is 44pt", 42 <= pill_box["height"] <= 48,
                  f"height={pill_box['height']:.0f}px")
        else:
            check("week pill renders", False)

        page.screenshot(path="/tmp/logs-header-compact.png")
        print("screenshot: /tmp/logs-header-compact.png")
        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURES")
        sys.exit(1)
    print("\nALL GREEN")


if __name__ == "__main__":
    main()
