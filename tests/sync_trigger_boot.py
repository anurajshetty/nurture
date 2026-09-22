#!/usr/bin/env python3
"""
Rendered validation for the sync-trigger fix (Willow, Sept 2026 — Anuraj
found in live verification that nothing pushed after saves).

Serves the built web bundle under /willow/, stubs the Supabase auth + REST
endpoints, then drives the REAL app in headless Chromium at iPhone
viewports:

  1. `__nurtureTest.seedEvent(...)` (the real `saveEvent` store path) queues
     exactly one outbox op synchronously — no push fires with the save.
  2. Without any manual refresh, the debounced trigger fires a real
     `syncNow()` push: the stubbed upsert receives the row (with the
     session's user_id healed onto it) and `getSyncDiagnostics()` shows
     pendingOutbox back at 0 and zero push failures.
  3. No page errors at 390x844 or 390x667; screenshots retained.

Usage: python3 tests/sync_trigger_boot.py
"""
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/nurture-v12"
DIST = os.path.join(REPO, "dist")
PORT = 8902
SHOT_DIR = os.path.join(REPO, "release-evidence", "sync-trigger")
os.makedirs(SHOT_DIR, exist_ok=True)

BOOT_USER_ID = "boot-user-1"

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
    upsert_payloads = []

    def auth_signup(route):
        # supabase-js signInAnonymously -> POST /auth/v1/signup
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
            upsert_payloads.append(payload)
            cors_json(route, 201, [payload])
        else:
            # Pull: nothing newer on the server.
            cors_json(route, 200, [])

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, width, height in [("844", 390, 844), ("667", 390, 667)]:
            ctx = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=2,
                timezone_id="America/Los_Angeles",
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
                page.screenshot(path=f"{SHOT_DIR}/sync-trigger-{label}-nohooks.png")
                check(f"[{label}] testhooks installed", False, "__nurtureTest never appeared")
                ctx.close()
                continue
            check(f"[{label}] testhooks installed", True)
            page.wait_for_timeout(3000)  # let the anonymous identity settle

            # Seed through the REAL store path (saveEvent), like NewLogForm.
            page.evaluate(
                "window.__nurtureTest.seedEvent({type:'note', data:{text:'sync trigger boot test'}})"
            )
            diag = page.evaluate("window.__nurtureTest.getSyncDiagnostics()")
            check(f"[{label}] save queues one outbox op", diag["pendingOutbox"] == 1, str(diag))
            check(f"[{label}] no failures yet", diag["pushFailuresTotal"] == 0, str(diag))

            # Without any manual refresh, the debounced trigger must push.
            try:
                page.wait_for_function(
                    "window.__nurtureTest.getSyncDiagnostics().pendingOutbox === 0",
                    timeout=20000,
                )
                drained = True
            except Exception:
                drained = False
            check(f"[{label}] outbox drained by an automatic push", drained)
            diag2 = page.evaluate("window.__nurtureTest.getSyncDiagnostics()")
            check(f"[{label}] zero push failures", diag2["pushFailuresTotal"] == 0, str(diag2))
            check(
                f"[{label}] upsert reached the server stub",
                len(upsert_payloads) >= 1,
                f"upserts seen: {len(upsert_payloads)}",
            )
            if upsert_payloads:
                check(
                    f"[{label}] pushed row carries the session user_id",
                    upsert_payloads[-1].get("user_id") == BOOT_USER_ID,
                    str(upsert_payloads[-1].get("user_id")),
                )
            check(f"[{label}] no page errors", len(errors) == 0, str(errors[:2]))
            page.screenshot(path=f"{SHOT_DIR}/sync-trigger-{label}.png")
            ctx.close()
        browser.close()


main()
