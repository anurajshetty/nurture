#!/usr/bin/env python3
"""
Rendered validation for the partner home (mockup 34).

Serves the built web bundle under /willow/, seeds a linked-partner state
into the app's SQLite-via-localStorage database, stubs the Supabase RPCs
(get_shared_events / get_my_loves / my_partner_link_status /
toggle_entry_love) with canned data, then drives the REAL PartnerHomeScreen
in headless Chromium at iPhone viewports:

  1. feed renders: "{her name}'s journey", glance lines, day groups,
     per-type cards, footer copy
  2. heart: tap to love (fills + "Loved by Sam"), tap again to undo
  3. paused state: "Sharing is paused for now" + exact zero-blame copy
  4. empty state: "Nothing shared yet" + little-window copy
  5. screenshots retained as evidence

Usage: python3 /tmp/partner_home_boot.py
"""
import base64
import functools
import http.server
import json
import os
import sqlite3
import sys
import threading
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/nurture-v12"
DIST = os.path.join(REPO, "dist")
PORT = 8901
SHOT_DIR = "/tmp/ph-screenshots"
os.makedirs(SHOT_DIR, exist_ok=True)

PDT = timezone(timedelta(hours=-7))
NOW = datetime.now(PDT)
TODAY_1920 = NOW.replace(hour=19, minute=20, second=0, microsecond=0)
TODAY_1847 = NOW.replace(hour=18, minute=47, second=0, microsecond=0)
TOMORROW_1400 = (NOW + timedelta(days=1)).replace(hour=14, minute=0, second=0, microsecond=0)
YESTERDAY_2302 = (NOW - timedelta(days=1)).replace(hour=23, minute=2, second=0, microsecond=0)
FRIDAY = NOW - timedelta(days=(NOW.weekday() - 4) % 7 or 7)
FRIDAY_1000 = FRIDAY.replace(hour=10, minute=0, second=0, microsecond=0)


def row(eid, etype, occurred, data):
    return {
        "id": eid,
        "user_id": "owner-uuid-1",
        "type": etype,
        "occurred_at": occurred.isoformat(),
        "visibility": "shared",
        "data": data,
        "created_at": occurred.isoformat(),
    }


SHARED_ROWS = [
    row("log1", "note", TODAY_1920, {"text": "Baby is so active tonight — little dance party after dinner.", "mood": "heavy but happy"}),
    row("kick1", "kick_session", TODAY_1847, {"movements": 10, "durationMin": 22}),
    row("appt1", "appointment", TOMORROW_1400, {"title": "OB visit", "provider": "Dr. Izu"}),
    row("act1", "activity", YESTERDAY_2302, {"sessionKey": "s1", "activityKind": "contraction", "count": 12, "spanSec": 3600, "avgIntervalSec": 300, "avgDurationSec": 45}),
    row("rep1", "report", FRIDAY_1000, {"title": "Week 33 summary", "summary": "A busy, happy week: 3 logs, 5 kick sessions, 1 appointment."}),
]

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
                # Real static asset under the subpath (wasm, favicon, ...).
                self.path = "/" + rel
            else:
                # SPA fallback (mirrors the deployed 404.html).
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *args):
        pass


def seed_partner_db(page):
    """Insert linked-partner kv rows into the app's persisted SQLite db."""
    raw_b64 = page.evaluate("window.localStorage.getItem('nurture.db.v1')")
    if not raw_b64:
        raise RuntimeError("app DB not in localStorage yet")
    db_path = "/tmp/ph-seed.db"
    with open(db_path, "wb") as f:
        f.write(base64.b64decode(raw_b64))
    con = sqlite3.connect(db_path)
    kv_rows = [
        ("partner.onboarding_role", "partner"),
        ("partner.linked", "1"),
        ("partner.onboarding_done", "1"),
        ("partner.my_name", "Sam"),
        ("partner.owner_name", "Sushmitha"),
    ]
    con.executemany("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", kv_rows)
    con.commit()
    con.close()
    with open(db_path, "rb") as f:
        seeded = base64.b64encode(f.read()).decode()
    page.evaluate(f"window.localStorage.setItem('nurture.db.v1', {json.dumps(seeded)})")


def json_route(payload):
    def handle(route):
        route.fulfill(
            status=200,
            headers={"content-type": "application/json", "access-control-allow-origin": "*"},
            body=json.dumps(payload() if callable(payload) else payload),
        )

    return handle


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    loved = set()
    state = {"rows": list(SHARED_ROWS), "sharing": True}

    def toggle_handler(route):
        req = route.request
        try:
            entry_id = json.loads(req.post_data or "{}").get("p_entry_id", "")
        except Exception:
            entry_id = ""
        if entry_id in loved:
            loved.discard(entry_id)
            out = False
        else:
            loved.add(entry_id)
            out = True
        route.fulfill(status=200, headers={"content-type": "application/json"}, body=json.dumps(out))

    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, width, height in [("844", 390, 844), ("667", 390, 667)]:
            page = browser.new_page(
                viewport={"width": width, "height": height},
                device_scale_factor=2,
                timezone_id="America/Los_Angeles",
            )
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("**/rest/v1/rpc/get_shared_events", json_route(lambda: state["rows"]))
            page.route("**/rest/v1/rpc/get_my_loves", json_route(lambda: sorted(loved)))
            page.route(
                "**/rest/v1/rpc/my_partner_link_status",
                json_route(lambda: [{"owner_id": "owner-uuid-1", "sharing_enabled": state["sharing"]}]),
            )
            page.route("**/rest/v1/rpc/toggle_entry_love", toggle_handler)

            # First boot: let the app create its DB, then seed partner state.
            page.goto(f"http://127.0.0.1:{PORT}/willow/", wait_until="networkidle")
            page.wait_for_timeout(2500)
            seed_partner_db(page)
            page.goto(f"http://127.0.0.1:{PORT}/willow/", wait_until="networkidle")
            try:
                page.wait_for_selector('[data-testid="partner-home"]', timeout=15000)
            except Exception:
                page.screenshot(path=f"{SHOT_DIR}/partner-home-{label}-noload.png")
                check(f"[{label}] partner home loads", False, "partner-home testID never appeared")
                page.close()
                continue

            body = page.inner_text('[data-testid="partner-home"]')
            check(f"[{label}] header title", "Sushmitha's journey" in body, body[:200])
            check(f"[{label}] mood glance", "She's feeling heavy but happy tonight." in body)
            check(f"[{label}] tender suffix", "worth an extra bit of love" in body)
            check(f"[{label}] next-up", "Next up: OB visit, tomorrow at 2:00 PM" in body)
            check(f"[{label}] kick highlight", "10 little kicks tonight" in body)
            check(f"[{label}] day group Today", "Today" in body)
            check(f"[{label}] contraction summary", "12 contractions, most about 5 minutes apart." in body)
            check(f"[{label}] footer copy", "You're her guest — enjoy the view." in body)
            check(f"[{label}] wave renders", page.locator('[data-testid="partner-wave"]').count() == 1)
            check(f"[{label}] no page errors", len(errors) == 0, errors[:2])

            # Heart: tap to love, tap again to undo.
            heart = page.locator('[data-testid="partner-heart-log1"]')
            check(f"[{label}] heart present", heart.count() == 1)
            loved_label = page.locator('[data-testid="partner-lovedby-log1"]')
            check(f"[{label}] unloved initially", loved_label.inner_text().strip() == "")
            heart.click()
            page.wait_for_function(
                "document.querySelector('[data-testid=\"partner-lovedby-log1\"]').textContent.includes('Loved by Sam')"
            )
            check(f"[{label}] love shows 'Loved by Sam'", True)
            page.screenshot(path=f"{SHOT_DIR}/partner-home-{label}-loved.png")
            heart.click()
            page.wait_for_function(
                "document.querySelector('[data-testid=\"partner-lovedby-log1\"]').textContent.trim() === ''"
            )
            check(f"[{label}] unlove clears label", True)

            page.screenshot(path=f"{SHOT_DIR}/partner-home-{label}.png", full_page=True)
            results[label] = body
            page.close()

        # Paused state (sharing off -> exact zero-blame copy).
        # NOTE: one page is seeded once and reused; state flips between reloads.
        page = browser.new_page(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            timezone_id="America/Los_Angeles",
        )
        page.route("**/rest/v1/rpc/get_shared_events", json_route(lambda: state["rows"]))
        page.route("**/rest/v1/rpc/get_my_loves", json_route(lambda: []))
        page.route(
            "**/rest/v1/rpc/my_partner_link_status",
            json_route(lambda: [{"owner_id": "owner-uuid-1", "sharing_enabled": state["sharing"]}]),
        )
        page.goto(f"http://127.0.0.1:{PORT}/willow/", wait_until="networkidle")
        page.wait_for_timeout(2500)
        seed_partner_db(page)
        state["rows"] = []
        state["sharing"] = False
        page.goto(f"http://127.0.0.1:{PORT}/willow/", wait_until="networkidle")
        page.wait_for_selector('[data-testid="partner-empty-paused"]', timeout=15000)
        body = page.inner_text('[data-testid="partner-home"]')
        check("[paused] heading", "Sharing is paused for now" in body)
        check(
            "[paused] exact copy",
            "Nothing is lost — when sharing is turned back on, the shared moments return here." in body,
        )
        page.screenshot(path=f"{SHOT_DIR}/partner-home-paused.png", full_page=True)

        # Empty state (sharing on, nothing shared) — same seeded page.
        state["sharing"] = True
        page.goto(f"http://127.0.0.1:{PORT}/willow/", wait_until="networkidle")
        page.wait_for_selector('[data-testid="partner-empty"]', timeout=15000)
        body = page.inner_text('[data-testid="partner-home"]')
        check("[empty] heading", "Nothing shared yet" in body)
        check("[empty] little-window copy", "a little window into the journey" in body)
        page.screenshot(path=f"{SHOT_DIR}/partner-home-empty.png", full_page=True)
        page.close()
        browser.close()

    server.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
