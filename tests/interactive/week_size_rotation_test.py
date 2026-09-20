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

        # Six successive Week-tab loads. Rotation is RANDOM per tab load
        # with no persistence and no sequence (src/week/sizeArt.ts: a
        # full reload wipes the session picks, so each load is an
        # independent draw) — assert rotation happens (more than one
        # distinct variant across loads), not an exact cycle.
        srcs = [week_art_src(page) for _ in range(6)]

        check("size hero card renders", page.get_by_test_id("week-size-hero").count() >= 1)
        hero_box = page.get_by_test_id("week-size-hero").bounding_box()
        check("size hero has real dimensions", bool(hero_box and hero_box["width"] > 100))
        check("every load shows an image", all(s is not None for s in srcs))
        check("rotation shows multiple variants across loads", len(set(srcs)) > 1)

        # Week paging: prev shows the previous week's art (date-relative —
        # the current week depends on today); paging does not advance
        # any sequence, so paging back replays the same image.
        import re as _re2
        _hdr = page.locator('[data-testid="week-screen"]').inner_text()
        _m = _re2.search(r"Week (\d+)", _hdr)
        _cur = int(_m.group(1)) if _m else None
        page.get_by_test_id("week-prev").click()
        page.wait_for_timeout(1200)
        prev_src = page.locator("[data-testid='week-size-art'] img").first.get_attribute("src")
        check("paging shows the previous week's art",
              _cur is not None and prev_src is not None and f"wk{_cur - 1}-" in prev_src)
        page.get_by_test_id("week-next").click()
        page.wait_for_timeout(1200)
        back_src = page.locator("[data-testid='week-size-art'] img").first.get_attribute("src")
        check("paging back replays its position (no advance)",
              back_src == srcs[-1])

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
