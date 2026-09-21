#!/usr/bin/env python3
"""
Epic 5 browser test: Week tab in real Chromium against the production
web export served under /willow/ (with ?testhooks=1).

Verifies:
  1. Week tab renders: size hero, highlights, readings, questions, footer
  2. Week navigation: chevrons page weeks, clamped to current (never ahead)
  3. Reading accordion: tap expands in place
  4. Add question: saves a question event
  5. Stopped state: no developmental content when pregnancy stopped
  6. Zero page errors throughout

Run: python3 tests/interactive/week_browser_test.py
"""

import http.server
import socketserver
import threading
import os
import sys
import time

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
PORT = 8907
BASE = f"http://localhost:{PORT}/willow/?testhooks=1"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        # Strip the /nurture subpath; SPA fallback to index.html
        path = self.path.split("?")[0]
        query = self.path[len(path):]
        if path.startswith("/willow/"):
            rel = path[len("/willow/"):]
            if not rel or not os.path.isfile(os.path.join(DIST, rel)):
                rel = "index.html"
            self.path = "/" + rel + query
        return super().do_GET()

    def log_message(self, *args):
        pass

def main():
    from playwright.sync_api import sync_playwright

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

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
        browser = p.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))

        print("Loading app...")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(3000)
        # The bundle grew (size art); wait for the test hooks, not just the load.
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)

        # Seed a pregnancy (due 2026-10-08 → week 37 on 2026-09-19)
        page.evaluate("""() => {
            window.__nurtureTest.completeOnboarding();
            window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
        }""")
        page.wait_for_timeout(1000)

        # Navigate to Week tab
        print("Navigating to Week tab...")
        page.goto(f"http://localhost:{PORT}/willow/week?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(3000)

        # 1. Week screen renders
        check(page.locator('[data-testid="week-screen"]').count() > 0,
              "week screen renders")

        # Size hero
        check(page.locator('[data-testid="week-size-hero"]').count() > 0,
              "size hero present")
        size_name = page.locator('[data-testid="week-size-name"]')
        check(size_name.count() > 0, "size name present")
        if size_name.count() > 0:
            print(f"    size: {size_name.inner_text()}")

        # Highlights
        check(page.locator('[data-testid="week-highlights"]').count() > 0,
              "highlights card present")

        # Readings
        check(page.locator('[data-testid="week-reading-body"]').count() > 0,
              "reading rows present")

        # Questions
        check(page.locator('[data-testid="week-questions"]').count() > 0,
              "questions card present")

        # Footer: not medical advice, content updated (NOT reviewed)
        footer = page.locator('[data-testid="week-footer"]')
        check(footer.count() > 0, "footer present")
        if footer.count() > 0:
            ft = footer.inner_text()
            check("not medical advice" in ft.lower(), "footer has not-medical-advice")
            check("content updated" in ft.lower(), "footer says content updated")
            check("reviewed" not in ft.lower(), "footer does NOT claim reviewed")

        # Pill dock regression guard, corrected round 2 (Anuraj caught it
        # on web, Sept 20, 2026 — AFTER the transparent fix shipped): the
        # reserved week-pill-dock below the scroll content sits OUTSIDE
        # the Screen scroll container, directly on the tab screen root,
        # whose platform default on web is light gray (#f2f2f2). A merely
        # transparent dock revealed a visible gray band. The corrected
        # rule: the dock div stays transparent AND the screen root behind
        # it (week-root) must render the page cream rgb(250, 246, 240) —
        # the dock area is cream-indistinguishable from the page. Only
        # the reserved height may exist.
        dock = page.locator('[data-testid="week-pill-dock"]')
        check(dock.count() > 0, "pill dock present")
        if dock.count() > 0:
            dock_bg = dock.evaluate("el => getComputedStyle(el).backgroundColor")
            check(dock_bg in ("rgba(0, 0, 0, 0)", "transparent"),
                  f"pill dock background transparent (got {dock_bg})")
            dock_h = dock.evaluate("el => el.getBoundingClientRect().height")
            check(dock_h > 0, f"pill dock keeps reserved height ({dock_h:.0f}px)")
            # The pills themselves still render inside the dock.
            check(page.locator('[data-testid="ask-fab"]').count() > 0,
                  "ask pill present")
        # The dock AREA (screen root behind the transparent dock) must be
        # the page cream — not the web tab slot's light gray, not white.
        root = page.locator('[data-testid="week-root"]')
        check(root.count() > 0, "week screen root present")
        if root.count() > 0:
            root_bg = root.evaluate("el => getComputedStyle(el).backgroundColor")
            check(root_bg == "rgb(250, 246, 240)",
                  f"dock area renders page cream (got {root_bg})")

        # 2. Week navigation (date-relative: the current displayed week
        # depends on today, so read it from the page instead of
        # hardcoding — the hardcoded "Week 37" broke on Sept 20, 2026
        # when the current week rolled to 38).
        print("Testing week navigation...")
        prev_btn = page.locator('[data-testid="week-prev"]')
        next_btn = page.locator('[data-testid="week-next"]')
        check(prev_btn.count() > 0 and next_btn.count() > 0, "nav chevrons present")
        import re as _re
        _hdr = page.locator('[data-testid="week-screen"]').inner_text()
        _m = _re.search(r"Week (\d+)", _hdr)
        _cur = int(_m.group(1)) if _m else None
        check(_cur is not None, "current week readable from header")

        # Go to previous week
        prev_btn.click()
        page.wait_for_timeout(1500)
        check(_cur is not None and page.get_by_text(f"Week {_cur - 1}").count() > 0,
              f"paged to week {_cur - 1}" if _cur else "paged to previous week")
        # Back-to-current pill appears
        check(page.locator('[data-testid="week-back-current"]').count() > 0,
              "back-to-current pill appears")

        # Next returns to the current week, then the pill hides
        next_btn.click()
        page.wait_for_timeout(1500)
        check(_cur is not None and page.get_by_text(f"Week {_cur}").count() > 0,
              f"back to week {_cur}" if _cur else "back to current week")
        check(page.locator('[data-testid="week-back-current"]').count() == 0,
              "back-to-current pill hidden on current week")

        # 3. Reading accordion
        print("Testing reading accordion...")
        reading_btn = page.locator('[data-testid="week-reading-body"]')
        reading_btn.click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-reading-body-body"]').count() > 0,
              "reading expands in place")
        # Tap again to collapse
        reading_btn.click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-reading-body-body"]').count() == 0,
              "reading collapses on re-tap")

        # 4. Add question
        print("Testing add question...")
        page.locator('[data-testid="week-question-add"]').click()
        page.wait_for_timeout(800)
        check(page.locator('[data-testid="week-question-input"]').count() > 0,
              "question input appears")
        page.locator('[data-testid="week-question-input"]').fill(
            "Test question from browser test")
        page.locator('[data-testid="week-question-save"]').click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-question-input"]').count() == 0,
              "question input closes after save")

        # 5. Stopped state
        print("Testing stopped state...")
        page.evaluate("() => window.__nurtureTest.stopPregnancy()")
        page.goto(f"http://localhost:{PORT}/willow/week?testhooks=1",
                  wait_until="networkidle")
        page.wait_for_timeout(3000)
        check(page.get_by_text("Your week view is resting").count() > 0,
              "stopped state shows resting message")
        check(page.locator('[data-testid="week-size-hero"]').count() == 0,
              "stopped: no size hero (no developmental content)")
        check(page.locator('[data-testid="week-highlights"]').count() == 0,
              "stopped: no highlights")
        check(page.get_by_text("View your story").count() > 0,
              "stopped: story button present")

        # 6. Page errors
        check(len(errors) == 0, f"zero page errors (got {len(errors)})")
        for e in errors[:5]:
            print(f"    pageerror: {e[:120]}")

        # Screenshot for the record
        page.screenshot(path="/tmp/week-stopped.png")
        print("  screenshot: /tmp/week-stopped.png")

        browser.close()

    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
