#!/usr/bin/env python3
"""
Bug-fix verification: Logs week selector navigation.

Verifies:
  1. Tapping a week WITH logs scrolls to that week's band (navigation works)
  2. Tapping a week WITHOUT logs shows "Nothing logged for Week N" empty state
  3. The empty state has a "Back to all weeks" button that restores the timeline
  4. Header shows the picked week number when empty state is active
  5. Zero page errors

Serves the built dist/ through Playwright route interception
(https://nurture.test) — plain localhost servers are blocked by Chromium's
Local Network Access checks in sandboxed environments.

Run: python3 tests/interactive/logs_week_picker_test.py
"""

import mimetypes
import os
import sys
import time

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"


def serve_dist(route):
    url = route.request.url
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
        # SPA fallback: tab routes have no static file; serve index.html.
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def main():
    from playwright.sync_api import sync_playwright

    passed, failed = 0, 0

    def check(cond, name):
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f"  ok: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, timeout=30000)
        # Fresh profile boots to onboarding (Week-as-home change): complete it
        # via the test hooks, then navigate DIRECTLY to the tab route with
        # ?testhooks=1 (expo-router drops the query on in-app redirects).
        try:
            page.wait_for_function(
                "() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        except Exception:
            check(False, "test hooks installed")
            browser.close()
            sys.exit(1)
        check(True, "test hooks installed")

        # Seed: pregnancy due 2026-10-08, one event in week 37, one in week 36
        page.evaluate("""() => {
            const t = window.__nurtureTest;
            t.completeOnboarding();
            t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
            t.seedEvent({ type: 'note', data: { text: 'week 37 note' }, occurredAt: '2026-09-18T10:00:00' });
            t.seedEvent({ type: 'note', data: { text: 'week 36 note' }, occurredAt: '2026-09-04T10:00:00' });
        }""")
        page.goto(ORIGIN + "/willow/logs?testhooks=1", timeout=30000)
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        page.wait_for_timeout(1500)

        # 1. Pick a week WITH logs (week 36) → should navigate (band visible)
        print("Pick week with logs...")
        page.locator('[data-testid="week-jump-button"]').click()
        page.wait_for_timeout(800)
        page.locator('[data-testid="week-row-36"]').click()
        page.wait_for_timeout(1500)
        check(page.locator('[data-testid="week-empty-state"]').count() == 0,
              "week with logs: no empty state")
        body = page.evaluate("() => document.body.innerText")
        check("week 36 note" in body, "week with logs: navigated to band")

        # 2. Pick a week WITHOUT logs (week 30) → empty state
        print("Pick empty week...")
        page.locator('[data-testid="week-jump-button"]').click()
        page.wait_for_timeout(800)
        page.locator('[data-testid="week-row-30"]').click()
        page.wait_for_timeout(1500)
        check(page.locator('[data-testid="week-empty-state"]').count() > 0,
              "empty week: empty state shown")
        empty_text = page.locator('[data-testid="week-empty-state"]').inner_text()
        check("Nothing logged for Week 30" in empty_text,
              "empty state names the week")
        # Header reflects the picked week
        check(page.get_by_text("Week 30").count() > 0,
              "header shows picked week")

        # 3. Back to all weeks restores the timeline
        print("Back to all weeks...")
        page.locator('[data-testid="week-empty-back"]').click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-empty-state"]').count() == 0,
              "back: empty state dismissed")
        body = page.evaluate("() => document.body.innerText")
        check("week 37 note" in body or "week 36 note" in body,
              "back: timeline restored")

        # 4. Zero page errors
        check(len(errors) == 0, f"zero page errors (got {len(errors)})")
        for e in errors[:5]:
            print(f"    pageerror: {e[:120]}")

        browser.close()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
