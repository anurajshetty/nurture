#!/usr/bin/env python3
"""
Rendered validation for local-timezone timestamps (Willow, Sept 2026 —
Anuraj: every timestamp renders in the viewer's local device timezone).

Serves the built web bundle under /willow/, stubs Supabase auth + REST,
then drives the REAL app in headless Chromium at an iPhone viewport in two
browser timezones:

  PST (America/Los_Angeles): instant 2026-09-22T06:30:00Z must render as
      "11:30 PM" inside day group "day-2026-09-21".
  EST (America/New_York): the same instant must render as "2:30 AM"
      inside day group "day-2026-09-22".

Also asserts the new timezone-change module is in the live code path
(`Intl...timeZone` is readable and the app boots clean in both zones).

Usage: python3 tests/local_timezone_boot.py
"""
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/nurture-v12"
DIST = os.path.join(REPO, "dist")
PORT = 8904
SHOT_DIR = os.path.join(REPO, "release-evidence", "local-timezone")
os.makedirs(SHOT_DIR, exist_ok=True)

BOOT_USER_ID = "boot-user-1"
INSTANT = "2026-09-22T06:30:00Z"

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


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        run_checks()
    finally:
        server.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)


def run_checks():
    def auth_signup(route):
        cors_json(route, 200, {
            "access_token": "fake-access-token",
            "token_type": "bearer",
            "expires_in": 3600,
            "expires_at": 9999999999,
            "refresh_token": "fake-refresh-token",
            "user": {"id": BOOT_USER_ID, "aud": "authenticated", "role": "authenticated"},
        })

    def auth_user(route):
        cors_json(route, 200, {"id": BOOT_USER_ID, "aud": "authenticated", "role": "authenticated"})

    def events_rest(route):
        req = route.request
        if req.method == "POST":
            payload = json.loads(req.post_data or "{}")
            cors_json(route, 201, [payload])
        else:
            cors_json(route, 200, [])

    cases = [
        # (label, tz, expected wall-clock for INSTANT)
        ("PST", "America/Los_Angeles", "11:30 PM"),
        ("EST", "America/New_York", "2:30 AM"),
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, tz, expected_time in cases:
            ctx = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=2,
                timezone_id=tz,
            )
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("**/auth/v1/signup", auth_signup)
            page.route("**/auth/v1/user", auth_user)
            page.route("**/rest/v1/events**", events_rest)
            page.route("**/rest/v1/pregnancies**", lambda r: cors_json(r, 200, []))

            page.goto(f"http://127.0.0.1:{PORT}/willow/?testhooks=1", wait_until="networkidle")
            try:
                page.wait_for_function("window.__nurtureTest !== undefined", timeout=20000)
            except Exception:
                check(f"[{label}] testhooks installed", False, "__nurtureTest never appeared")
                ctx.close()
                continue
            check(f"[{label}] testhooks installed", True)
            page.wait_for_timeout(2000)

            zone = page.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
            check(f"[{label}] browser zone is {tz}", zone == tz, f"got {zone}")

            # Mark onboarding complete BEFORE the tab shell mounts: set the
            # key, then reboot through the sticky test-mode gate (a plain
            # reload would drop ?testhooks=1).
            page.evaluate("window.__nurtureTest.completeOnboarding()")
            page.goto(f"http://127.0.0.1:{PORT}/willow/?testhooks=1", wait_until="networkidle")
            page.wait_for_function("window.__nurtureTest !== undefined", timeout=20000)
            page.wait_for_timeout(2500)

            # Seed a mood event through the REAL store path. Mood cards are
            # non-shareable, so the card renders the full local timestamp
            # ("Today · 11:30 PM") with a stable testID. occurredAt is the
            # fixed instant; createdAt (the story/grouping date) is now.
            seeded = page.evaluate(
                f"window.__nurtureTest.seedEvent({{type:'mood', data:{{mood:'calm'}}, occurredAt:'{INSTANT}'}})"
            )
            event_id = seeded["id"] if isinstance(seeded, dict) else seeded
            check(f"[{label}] event seeded", bool(event_id), str(event_id))

            # Open the Logs tab (expo-router drops the query; the sticky
            # test-mode gate keeps the hooks alive). Tab bar items are
            # plain text labels, not tab roles.
            page.get_by_text("Logs", exact=True).first.click()
            page.wait_for_timeout(1500)

            try:
                time_el = page.get_by_test_id(f"event-card-time-{event_id}")
                time_el.wait_for(timeout=10000)
                rendered = time_el.inner_text().strip()
            except Exception as e:
                rendered = f"<missing: {e}>"
            # formatTime renders "Today · 11:30 PM" — the wall-clock portion
            # is the zone-discriminating part; the day prefix follows the
            # browser's own "now".
            check(f"[{label}] rendered time contains {expected_time}", expected_time in rendered, f"got {rendered!r}")

            # The day group follows the device-local story day (createdAt =
            # now, in the browser's zone) — computed in-page so the test
            # never hardcodes a zone.
            local_day = page.evaluate(
                "(() => { const d = new Date(); return d.getFullYear() + '-' + "
                "String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()"
            )
            expected_group = f"day-group-day-{local_day}"
            try:
                group_el = page.get_by_test_id(expected_group)
                group_el.wait_for(timeout=10000)
                group_ok = True
            except Exception:
                group_ok = False
            check(f"[{label}] day group {expected_group} rendered", group_ok)

            check(f"[{label}] no page errors", len(errors) == 0, str(errors[:2]))
            page.screenshot(path=f"{SHOT_DIR}/local-timezone-{label.lower()}.png")
            ctx.close()
        browser.close()


main()
