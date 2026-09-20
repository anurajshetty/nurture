#!/usr/bin/env python3
"""Positional visual check: Week-tab baby-size card per-load rotation.

Verifies at 390x844 against the built web export (dist/):
1. The size hero card renders with an image on the Week tab.
2. Four successive Week-tab loads cycle the watercolor variants
   1 -> 2 -> 3 -> 1 (src differs on loads 1-3, load 4 repeats load 1).
3. Zero page errors.

Run: python3 tests/interactive/week_size_rotation_test.py
"""
import os, sys, mimetypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(REPO, "dist")
SHOT_DIR = os.path.join(REPO, ".screenshots", "rotation")
os.makedirs(SHOT_DIR, exist_ok=True)

ORIGIN = "https://willow.test"
WEEK = ORIGIN + "/willow/week?testhooks=1"

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

def serve_dist(route):
    url = route.request.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    with open(fpath, "rb") as f:
        body = f.read()
    route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")

SEED = """() => {
  const t = window.__nurtureTest;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
}"""

def week_art_src(page):
    page.goto(WEEK, wait_until="networkidle")
    page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
    page.wait_for_selector("[data-testid='week-size-hero']", timeout=15000)
    page.wait_for_timeout(1500)
    img = page.locator("[data-testid='week-size-art'] img")
    if img.count() == 0:
        return None
    return img.first.get_attribute("src")

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"))
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(ORIGIN + "/**", serve_dist)

        # Boot + seed (this load shows the empty state; no rotation advance).
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED)

        # Four successive Week-tab loads.
        srcs = [week_art_src(page) for _ in range(4)]

        check("size hero card renders", page.get_by_test_id("week-size-hero").count() >= 1)
        hero_box = page.get_by_test_id("week-size-hero").bounding_box()
        check("size hero has real dimensions", bool(hero_box and hero_box["width"] > 100))
        check("load 1 shows an image", srcs[0] is not None)
        check("load 2 advances to a different variant", srcs[1] is not None and srcs[1] != srcs[0])
        check("load 3 advances to a third variant",
              srcs[2] is not None and srcs[2] != srcs[0] and srcs[2] != srcs[1])
        check("load 4 cycles back to variant 1", srcs[3] == srcs[0])

        # Week paging: prev -> week 36 shows its variant 1 (fresh week);
        # paging does not advance any sequence.
        page.get_by_test_id("week-prev").click()
        page.wait_for_timeout(1200)
        prev_src = page.locator("[data-testid='week-size-art'] img").first.get_attribute("src")
        check("paging to week 36 shows its variant 1",
              prev_src is not None and "wk36-romaine-1" in prev_src)
        page.get_by_test_id("week-next").click()
        page.wait_for_timeout(1200)
        back_src = page.locator("[data-testid='week-size-art'] img").first.get_attribute("src")
        check("paging back to week 37 replays its position (no advance)",
              back_src == srcs[3])

        page.screenshot(path=os.path.join(SHOT_DIR, "week-size-rotation.png"))
        browser.close()

    check("zero page errors", len(errors) == 0)
    for e in errors:
        print("PAGEERROR:", e)
    failed = [n for n, c in results if not c]
    print(f"=== week_size_rotation: {len(results)-len(failed)}/{len(results)} passed ===")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
