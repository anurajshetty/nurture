#!/usr/bin/env python3
"""
Bug-fix verification: Logs week selector navigation.

Verifies:
  1. Tapping a week WITH logs scrolls to that week's band (navigation works)
  2. Tapping a week WITHOUT logs shows "Nothing logged for Week N" empty state
  3. The empty state has a "Back to all weeks" button that restores the timeline
  4. Header shows the picked week number when empty state is active
  5. Zero page errors

Run: python3 tests/interactive/logs_week_picker_test.py
"""

import http.server
import socketserver
import threading
import os
import sys
import time

DIST = os.path.expanduser("~/workspace/epic5-work/dist")
PORT = 8913

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]
        query = self.path[len(path):]
        if path.startswith("/nurture/"):
            rel = path[len("/nurture/"):]
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
    time.sleep(0.5)

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

        base = f"http://localhost:{PORT}/nurture"
        page.goto(f"{base}/?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(4000)

        # Seed: pregnancy due 2026-10-08, one event in week 37, one in week 36
        page.evaluate("""() => {
            window.__nurtureTest.completeOnboarding();
            window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
            window.__nurtureTest.seedEvent({ type: 'note', data: { text: 'week 37 note' }, occurredAt: '2026-09-18T10:00:00' });
            window.__nurtureTest.seedEvent({ type: 'note', data: { text: 'week 36 note' }, occurredAt: '2026-09-04T10:00:00' });
        }""")
        page.wait_for_timeout(1000)
        page.goto(f"{base}/logs?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(3000)

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
        check(page.get_by_text("Week 30 ▾").count() > 0,
              "header shows picked week")

        # 3. Back to all weeks restores the timeline
        print("Back to all weeks...")
        page.locator('[data-testid="week-empty-back"]').click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-empty-state"]').count() == 0,
              "back: empty state dismissed")
        body = page.evaluate("() => document.body.innerText")
        check("week 37 note" in body or "week 35 note" in body,
              "back: timeline restored")

        # 4. Zero page errors
        check(len(errors) == 0, f"zero page errors (got {len(errors)})")
        for e in errors[:5]:
            print(f"    pageerror: {e[:120]}")

        browser.close()

    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
