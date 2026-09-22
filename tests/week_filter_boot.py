#!/usr/bin/env python3
"""
Rendered validation for the week-pill filter timezone fix (Willow, Sept 2026
— Anuraj caught live: selecting the latest week pill showed an empty feed
while "All weeks" showed the entries).

Serves the built web bundle under /willow/, stubs Supabase auth + REST,
then drives the REAL app in headless Chromium at iPhone viewports
(390x844 and 390x667) in America/Los_Angeles:

  - Seeds a pregnancy with due date 2026-10-13 (a pregnancy-week boundary
    falls on 2026-09-22, i.e. "tomorrow" relative to the pinned today).
  - Seeds two mood entries through the real store at 11:30 PM and 9:00 AM
    device-local on 2026-09-21 (the evening entry is already the next UTC
    day — the exact shape that used to vanish).
  - Asserts the default week-pill view, the explicitly selected latest
    week pill, and "All weeks" ALL show both entries (no week-empty-state).

Usage: python3 tests/week_filter_boot.py
"""
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/nurture-v12"
# Override with WILLOW_DIST to validate a specific build (e.g. a pristine
# worktree export that excludes other agents' uncommitted changes).
DIST = os.environ.get("WILLOW_DIST") or os.path.join(REPO, "dist")
PORT = 8913
SHOT_DIR = os.path.join(REPO, "release-evidence", "week-filter")
os.makedirs(SHOT_DIR, exist_ok=True)

DUE_DATE = "2026-10-13"  # week boundary on 2026-09-22

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/willow/" or path == "/willow":
            self.path = "/index.html"
        elif path.startswith("/willow/"):
            rel = path[len("/willow/"):]
            if os.path.isfile(os.path.join(DIST, rel)):
                self.path = "/" + rel
            else:
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *args):
        pass


def cors_json(route, status, payload):
    route.fulfill(
        status=status,
        headers={
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "Content-Range",
        },
        body=json.dumps(payload),
    )


def run_case(p, height):
    label = f"390x{height}"
    browser = p.chromium.launch()
    ctx = browser.new_context(
        viewport={"width": 390, "height": height},
        device_scale_factor=2,
        timezone_id="America/Los_Angeles",
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/auth/v1/signup", lambda r: cors_json(r, 200, {
        "access_token": "x", "token_type": "bearer", "expires_in": 3600,
        "user": {"id": "u1", "aud": "authenticated", "role": "authenticated"}}))
    page.route("**/auth/v1/user", lambda r: cors_json(r, 200,
        {"id": "u1", "aud": "authenticated", "role": "authenticated"}))
    page.route("**/rest/v1/events**", lambda r: cors_json(r, 200, []))
    page.route("**/rest/v1/pregnancies**", lambda r: cors_json(r, 200, []))

    page.goto(f"http://127.0.0.1:{PORT}/willow/?testhooks=1", wait_until="networkidle")
    try:
        page.wait_for_function("window.__nurtureTest !== undefined", timeout=20000)
    except Exception:
        check(f"[{label}] testhooks installed", False)
        browser.close()
        return
    page.wait_for_timeout(2000)
    page.evaluate("window.__nurtureTest.completeOnboarding()")
    page.evaluate(f"window.__nurtureTest.seedPregnancy({{dueDate:'{DUE_DATE}'}})")
    # 11:30 PM device-local Sep 21 (next UTC day) + 9:00 AM control.
    page.evaluate(
        "window.__nurtureTest.seedEvent({type:'mood', data:{mood:'evening-calm'},"
        " occurredAt: new Date(2026, 8, 21, 23, 30, 0).toISOString(),"
        " createdAt: new Date(2026, 8, 21, 23, 30, 0).toISOString()})"
    )
    page.evaluate(
        "window.__nurtureTest.seedEvent({type:'mood', data:{mood:'morning-calm'},"
        " occurredAt: new Date(2026, 8, 21, 9, 0, 0).toISOString(),"
        " createdAt: new Date(2026, 8, 21, 9, 0, 0).toISOString()})"
    )
    page.goto(f"http://127.0.0.1:{PORT}/willow/?testhooks=1", wait_until="networkidle")
    page.wait_for_function("window.__nurtureTest !== undefined", timeout=20000)
    page.wait_for_timeout(2500)
    page.get_by_text("Logs", exact=True).first.click()
    page.wait_for_timeout(2000)

    def card_count():
        return page.get_by_text("evening-calm").count() + page.get_by_text("morning-calm").count()

    # 1. Default view (current-week pill).
    check(f"[{label}] default pill view shows both entries", card_count() == 2,
          f"got {card_count()}")
    check(f"[{label}] default view has no week-empty-state",
          page.get_by_test_id("week-empty-state").count() == 0)
    page.screenshot(path=os.path.join(SHOT_DIR, f"week-filter-default-{height}.png"))

    # 2. Explicitly select the latest week pill.
    page.get_by_test_id("week-jump-button").click()
    page.wait_for_timeout(800)
    opts = page.locator("[data-testid^='week-filter-option-']")
    latest = opts.nth(1).inner_text().strip()
    opts.nth(1).click()
    page.wait_for_timeout(1500)
    check(f"[{label}] latest pill ({latest}) shows both entries", card_count() == 2,
          f"got {card_count()}")
    check(f"[{label}] latest pill has no week-empty-state",
          page.get_by_test_id("week-empty-state").count() == 0)
    page.screenshot(path=os.path.join(SHOT_DIR, f"week-filter-latest-{height}.png"))

    # 3. "All weeks" still shows both.
    page.get_by_test_id("week-jump-button").click()
    page.wait_for_timeout(800)
    page.get_by_test_id("week-filter-option-all").click()
    page.wait_for_timeout(1500)
    check(f"[{label}] all-weeks shows both entries", card_count() == 2,
          f"got {card_count()}")
    page.screenshot(path=os.path.join(SHOT_DIR, f"week-filter-all-{height}.png"))

    check(f"[{label}] no page errors", len(errors) == 0, str(errors[:2]))
    browser.close()


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            run_case(p, 844)
            run_case(p, 667)
    finally:
        server.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)


main()
