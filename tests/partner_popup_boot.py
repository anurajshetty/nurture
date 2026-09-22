#!/usr/bin/env python3
"""
Rendered boot validation for the partner onboarding one-popup add flow
(Anuraj's five points, Sept 2026 — approved mockup 33-partner-welcome.html).

Serves the built web bundle under /willow/, stubs the partner-invite RPCs
with an in-memory invite list, then drives the REAL ShareCodeScreen in
headless Chromium at 390x844:

  1. empty card: no duplicate explainer, "Add a partner" below the list
  2. popup name step: "Who is this code for?" + quiet-until-typed Create code
  3. popup code step: JUST the 6-char code + Copy (no name field)
  4. dismiss via x -> list shows the new partner as "Name - Invited"
  5. row x -> RemoveConfirmDialog -> confirm -> "Invite removed."
  6. 5-of-5: warm max note replaces the add option
  7. zero page errors throughout

Usage: python3 tests/partner_popup_boot.py  (run from the repo root)
Screenshots: docs/verification/partner-popup-*.png
"""
import functools
import http.server
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/nurture-v12"
DIST = os.path.join(REPO, "dist")
PORT = 8903
SHOT_DIR = os.path.join(REPO, "docs", "verification")
os.makedirs(SHOT_DIR, exist_ok=True)

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
                self.path = "/index.html"  # SPA fallback
        return super().do_GET()

    def log_message(self, *args):
        pass


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

    # In-memory invite list backing the stubbed RPCs.
    state = {"invites": [], "next": 1, "codes": ["K7X2QM", "Q9W4ER", "T2Y8UI", "P5A3SD", "M8N6BV"]}

    def rows():
        return [
            {
                "invite_id": inv["id"],
                "partner_name": inv["name"],
                "status": inv["status"],
                "code": inv["code"] if inv["status"] == "pending" else None,
                "sharing_enabled": inv["sharing"],
            }
            for inv in state["invites"]
        ]

    def create_handler(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except Exception:
            body = {}
        name = str(body.get("p_name", "") or "").strip() or "Partner"
        if len(state["invites"]) >= 5:
            route.fulfill(
                status=400,
                headers={"content-type": "application/json"},
                body=json.dumps({"message": "max_partners_reached"}),
            )
            return
        code = state["codes"][(state["next"] - 1) % len(state["codes"])]
        inv = {
            "id": f"inv-{state['next']}",
            "name": name,
            "status": "pending",
            "code": code,
            "sharing": True,
        }
        state["next"] += 1
        state["invites"].append(inv)
        route.fulfill(
            status=200,
            headers={"content-type": "application/json", "access-control-allow-origin": "*"},
            body=json.dumps({"code": code}),
        )

    def revoke_handler(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except Exception:
            body = {}
        iid = str(body.get("p_invite_id", ""))
        state["invites"] = [i for i in state["invites"] if i["id"] != iid]
        route.fulfill(
            status=200,
            headers={"content-type": "application/json", "access-control-allow-origin": "*"},
            body=json.dumps(True),
        )

    def sharing_handler(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except Exception:
            body = {}
        iid = str(body.get("p_invite_id", ""))
        for inv in state["invites"]:
            if inv["id"] == iid:
                inv["sharing"] = bool(body.get("p_enabled", True))
        route.fulfill(
            status=200,
            headers={"content-type": "application/json", "access-control-allow-origin": "*"},
            body=json.dumps(True),
        )

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            timezone_id="America/Los_Angeles",
        )
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/rest/v1/rpc/my_partner_invites", json_route(rows))
        page.route("**/rest/v1/rpc/create_partner_invite", create_handler)
        page.route("**/rest/v1/rpc/revoke_partner", revoke_handler)
        page.route("**/rest/v1/rpc/set_partner_sharing", sharing_handler)
        page.route("**/rest/v1/rpc/my_partner_link", json_route([]))

        base = f"http://127.0.0.1:{PORT}/willow/"
        page.goto(base + "?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.evaluate("window.__nurtureTest.completeOnboarding()")
        page.evaluate(
            "window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', ownerName: 'Sushmitha' })"
        )
        page.goto(base + "you?testhooks=1", wait_until="networkidle")
        page.wait_for_selector('[data-testid="partner-sharing-row"]', timeout=20000)

        # Open the partners sheet.
        page.click('[data-testid="partner-sharing-row"]')
        page.wait_for_selector('[data-testid="partners-list-card"]', timeout=15000)
        page.wait_for_timeout(700)  # sheet entrance animation

        # 1. Empty card: no duplicate explainer, add button below the list.
        card_text = page.inner_text('[data-testid="partners-list-card"]')
        check("empty card has no duplicate explainer", "Invite the people you want following along" not in card_text)
        check("empty card shows 'Your partners'", "Your partners" in card_text)
        check('"Add a partner" below the list', page.is_visible('[data-testid="partners-list-add"]'))
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-01-empty.png")

        # 2. Popup name step.
        page.click('[data-testid="partners-list-add"]')
        page.wait_for_selector('[data-testid="partner-add-popup"]', timeout=10000)
        page.wait_for_timeout(700)
        popup_text = page.inner_text('[data-testid="partner-add-popup"]')
        check('popup asks "Who is this code for?"', "Who is this code for?" in popup_text)
        check("name field present", page.is_visible('[data-testid="partner-popup-name"]'))
        create_btn = page.locator('[data-testid="partner-popup-create"]')
        check('"Create code" quiet until a name is typed', create_btn.is_disabled())
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-02-name-step.png")

        # 3. Type a name -> Create code -> code-only step.
        page.fill('[data-testid="partner-popup-name"]', "Maya")
        page.wait_for_function(
            "document.querySelector('[data-testid=\"partner-popup-create\"]').getAttribute('aria-disabled') !== 'true'",
            timeout=10000,
        )
        check('"Create code" enables after typing', not create_btn.is_disabled())
        create_btn.click()
        page.wait_for_selector('[data-testid="partner-popup-code"]', timeout=15000)
        page.wait_for_timeout(400)
        code_text = page.inner_text('[data-testid="partner-popup-code"]').strip()
        check("code-only step shows a 6-char code", len(code_text) == 6, f"got {code_text!r}")
        check("code step has Copy", page.is_visible('[data-testid="partner-popup-copy"]'))
        check("code step shows no name field", page.locator('[data-testid="partner-popup-name"]').count() == 0)
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-03-code-step.png")

        # 4. Dismiss via x -> list shows the new partner.
        page.click('[data-testid="partner-popup-close"]')
        page.wait_for_selector('[data-testid="partner-popup-code"]', state="detached", timeout=10000)
        page.wait_for_selector('[data-testid="partner-row-inv-1"]', timeout=15000)
        row_text = page.inner_text('[data-testid="partner-row-inv-1"]')
        check('list shows "Maya · Invited"', "Maya" in row_text and "Invited" in row_text)
        check("pending row shows the code", page.is_visible('[data-testid="partner-row-code-inv-1"]'))
        check("pending row has Copy", page.is_visible('[data-testid="partner-row-copy-inv-1"]'))
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-04-list-after-add.png")

        # 5. Row x -> confirmation dialog -> confirm -> removed.
        page.click('[data-testid="partner-row-remove-inv-1"]')
        page.wait_for_selector('[data-testid="remove-partner-dialog"]', timeout=10000)
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-05-remove-confirm.png")
        check("remove confirmation dialog opens", True)
        page.click('[data-testid="remove-partner-confirm"]')
        page.wait_for_selector('[data-testid="partner-row-inv-1"]', state="detached", timeout=15000)
        check("confirming removes the row", page.locator('[data-testid="partner-row-inv-1"]').count() == 0)

        # 6. 5-of-5: seed five invites, reopen the sheet.
        for i, nm in enumerate(["Asha", "Ravi", "Tara", "Dev", "Noor"]):
            state["invites"].append(
                {
                    "id": f"seed-{i}",
                    "name": nm,
                    "status": "accepted" if i % 2 else "pending",
                    "code": state["codes"][i],
                    "sharing": True,
                }
            )
        page.click('[data-testid="partners-list-back"]')  # close sheet
        page.wait_for_selector('[data-testid="partner-add-sheet"]', state="detached", timeout=15000)
        page.click('[data-testid="partner-sharing-row"]')
        page.wait_for_selector('[data-testid="partners-list-max"]', timeout=15000)
        page.wait_for_timeout(700)
        max_text = page.inner_text('[data-testid="partners-list-max"]')
        check(
            "5/5 warm max note",
            "You've added 5 partners — the most Willow allows right now." in max_text,
        )
        check("5/5 hides the add option", page.locator('[data-testid="partners-list-add"]').count() == 0)
        # Scroll the sheet to the bottom so the warm max note is visible.
        page.evaluate(
            "(() => { const el = document.querySelector('[data-testid=\"partners-list\"]');"
            " if (el) el.scrollTop = el.scrollHeight; })()"
        )
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SHOT_DIR}/partner-popup-06-max-five.png")

        page.close()
        browser.close()

    check("zero page errors", len(errors) == 0, "; ".join(errors[:3]))
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
