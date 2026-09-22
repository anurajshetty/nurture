"""Interactive browser test: onboarding profile + partner-invite sharing.

Walks the new onboarding Screen 1 (her name + due date + optional
birthday) and Screen 2 (partner/family invite) in real Chromium at
390x844, then the You tab's Account section.

Run with:
    python3 tests/interactive/onboarding_sharing_test.py

Expects a freshly-built `dist/` (npm run export:web). Serves it under
/willow/ with the SPA fallback (like the deployed 404.html).
"""

import datetime
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

# The repo under test is the one this file lives in, so the suite works in
# any workdir clone (nurture-v12, nurture-onboarding, ...).
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = "https://nurture.test/willow/?testhooks=1"
ONBOARDING_URL = "https://nurture.test/willow/onboarding?testhooks=1"

errors: list[str] = []
failures: list[str] = []


def check(cond: bool, name: str) -> None:
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)



def _note_console(m) -> None:
    # "Failed to load resource" is network outcome (the backend migration
    # isn't applied / the sandbox blocks the API host) — never a JS bug.
    # Uncaught exceptions still arrive via pageerror and fail the run.
    if m.type == "error" and not (m.text or "").startswith("Failed to load resource"):
        errors.append(m.text)


def launch_browser(p):
    """Default Playwright launch, falling back to the full Chromium build
    when the headless-shell binary is not installed in this environment."""
    try:
        return p.chromium.launch(args=["--no-sandbox"])
    except Exception:
        full = os.path.expanduser(
            "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
        )
        if os.path.exists(full):
            return p.chromium.launch(args=["--no-sandbox"], executable_path=full)
        raise


def fresh_dist() -> None:
    """Fail loudly unless dist/ exists and index.html looks like our app."""
    index = os.path.join(REPO, "dist", "index.html")
    if not os.path.exists(index):
        sys.exit("dist/index.html missing. Run `npm run export:web` first.")
    with open(index, encoding="utf-8", errors="replace") as f:
        head = f.read(4000)
    if "__nurtureTest" not in head and "expo" not in head.lower():
        sys.exit("dist/index.html does not look like the Willow bundle. Rebuild first.")


def serve_with_fallback(pg, ctx):
    index = os.path.join(REPO, "dist", "index.html")
    with open(index, "rb") as f:
        index_bytes = f.read()

    def handler(route):
        req = route.request
        path = req.url.split("?")[0].split("https://nurture.test")[1]
        # Serve any real file from dist/ (bundle chunks, the sql.js wasm,
        # assets). Everything else under /willow/* gets the SPA fallback.
        rel = path[len("/willow/"):] if path.startswith("/willow/") else path.lstrip("/")
        disk = os.path.join(REPO, "dist", rel)
        if rel and os.path.isfile(disk):
            mime = "application/javascript" if disk.endswith(".js") else (
                "application/wasm" if disk.endswith(".wasm") else "application/octet-stream"
            )
            with open(disk, "rb") as f:
                return route.fulfill(body=f.read(), content_type=mime)
        # SPA fallback: every unknown /willow/* route serves index.html.
        route.fulfill(body=index_bytes, content_type="text/html")

    def supabase_stub(route):
        # The backend isn't reachable from the test sandbox; answer API
        # calls with a clean JSON error so no "Failed to load resource"
        # console error is logged. The redeem endpoint simulates the real
        # invalid-code response; everything else looks like the migration
        # was never applied. The app degrades gracefully either way.
        url = route.request.url
        if "/rpc/redeem_partner_invite" in url:
            posted = route.request.post_data or ""
            if "ABCDEF" in posted:
                # The one known-good code: redeem succeeds.
                status, body = 200, "null"
            else:
                status, body = 400, '{"code":"P0001","message":"invalid_code: unknown or already redeemed"}'
        else:
            status, body = 404, '{"code":"42883","message":"function does not exist"}'
        route.fulfill(
            status=status,
            content_type="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Range",
            },
            body=body,
        )

    ctx.route("https://*.supabase.co/**", supabase_stub)
    ctx.route("https://nurture.test/willow/**", handler)
    pg.goto(BASE)
    pg.wait_for_timeout(1500)
    pg.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)


def main() -> None:
    fresh_dist()
    urllib.request.urlopen("https://example.com", timeout=10)  # fail fast offline

    with sync_playwright() as p:
        browser = launch_browser(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", _note_console)
        serve_with_fallback(pg, ctx)

        # ----------------------------------------------------------------
        # A. Screen 1: required name, disabled Continue, gentle hint.
        # ----------------------------------------------------------------
        pg.goto(ONBOARDING_URL)
        pg.wait_for_timeout(1200)
        check(
            pg.get_by_test_id("role-split").count() > 0,
            "a0 welcome role split renders before onboarding",
        )
        pg.get_by_test_id("role-split-mom").click()
        pg.wait_for_timeout(500)
        pg.get_by_test_id("onboarding-get-started").click()

        check(
            pg.get_by_test_id("onboarding-owner-name").count() > 0
            and pg.get_by_text("Just the basics").count() > 0,
            "a1 profile screen renders",
        )
        cont = pg.get_by_test_id("onboarding-profile-continue")
        cont.click()
        pg.wait_for_timeout(300)
        check(
            pg.get_by_test_id("onboarding-owner-name").count() > 0,
            "a1 continue disabled with empty name",
        )
        check(
            pg.get_by_test_id("onboarding-continue-hint").count() > 0,
            "a1 gentle hint visible",
        )
        pg.get_by_test_id("onboarding-owner-name").fill("Priya")
        # The due date is mandatory: tap the card and pick one.
        pg.get_by_test_id("onboarding-date-card").click()
        pg.get_by_test_id("onboarding-date-picker").fill("2026-10-08")
        pg.wait_for_timeout(500)
        check(
            pg.get_by_test_id("onboarding-week-helper").count() > 0,
            "a1 week helper appears once a valid date is picked",
        )
        check(
            pg.get_by_test_id("onboarding-dob-add").count() > 0,
            "a1 birthday stays optional (add affordance, not required)",
        )
        # Birthday: add and pick a date.
        pg.get_by_test_id("onboarding-dob-add").click()
        dob_field = pg.get_by_test_id("onboarding-dob-picker")
        dob_field.fill("1990-04-12")
        check(dob_field.input_value() == "1990-04-12", "a1 birthday picker takes a date")
        cont.click()

        # ----------------------------------------------------------------
        # B. Screen 2: her share screen (Anuraj, Sept 2026): the
        # "Your partners" card is NOT part of onboarding — it lives only
        # on the You-tab card. Onboarding shows the name-first invite
        # composer directly (name input + Cancel/Create code).
        # ----------------------------------------------------------------
        headline = pg.get_by_text("Share this journey with your partner?")
        check(headline.count() > 0, "b2 share screen headline renders")
        plist = pg.get_by_test_id("partners-list")
        check(
            plist.count() > 0,
            "b2 share surface renders",
        )
        check(
            "Your partners" not in (plist.inner_text() or ""),
            "b2 onboarding shows no Your partners card",
        )
        check(
            pg.get_by_test_id("partners-list-count").count() == 0,
            "b2 no partners count on the onboarding surface",
        )
        check(
            pg.get_by_test_id("partner-add-name").count() > 0,
            "b2 name input is shown directly (who is this code for)",
        )
        check(
            pg.get_by_test_id("partner-add-cancel").count() > 0
            and pg.get_by_test_id("partner-add-create").count() > 0,
            "b2 Cancel and Create code buttons are shown",
        )
        # No system Share button anywhere on the named-invite surface —
        # copy is the only handoff.
        check(
            pg.get_by_test_id("share-code-share").count() == 0,
            "b2 no system Share button on the partners surface",
        )
        pg.get_by_test_id("onboarding-share-continue").click()
        check(
            pg.get_by_text("A couple of quick things").count() > 0,
            "b2 continue lands on the quick-things screen",
        )
        check(
            pg.evaluate("window.__nurtureTest && window.__nurtureTest.lastInviteShare") is None,
            "b2 no invite is created by the code surface",
        )
        # The baby's name field lives on the quick-things screen now.
        pg.get_by_test_id("onboarding-baby-name").fill("Wren")
        pg.get_by_test_id("onboarding-chips-continue").click()

        # Intro screens unchanged along the way: notifications.
        check(
            pg.get_by_text("A gentle heads-up").count() > 0,
            "c1 notifications screen unchanged",
        )
        pg.get_by_test_id("onboarding-notifications-skip").click()
        check(pg.get_by_text("all set").count() > 0, "c1 done screen unchanged")
        pg.get_by_test_id("onboarding-finish").click()
        pg.wait_for_timeout(1500)

        # Routing fix (Week job, Sept 2026): finishing onboarding must land
        # on the Week tab leaf — the bare '/(tabs)' group path renders
        # "Unmatched Route" in the static web export.
        check("/willow/week" in pg.url, "c1 finish redirects to the Week tab leaf")
        check(
            pg.get_by_role("tab", name="Week").get_attribute("aria-selected") == "true",
            "c1 week tab is active after onboarding",
        )

        # Name + birthday landed in the You tab's Account section.
        pg.get_by_role("tab", name="You").click()
        pg.wait_for_timeout(800)
        check(
            pg.get_by_text("Priya").count() > 0,
            "c1 her name is visible in the You tab",
        )
        check(
            pg.get_by_text("Apr 12, 1990").count() > 0,
            "c1 birthday saved and shown",
        )
        check(pg.get_by_text("Wren").count() > 0, "c1 baby's name saved")

        # ----------------------------------------------------------------
        # D. Partner path: role split -> code entry -> graceful invalid.
        # ----------------------------------------------------------------
        ctx3 = browser.new_context(viewport={"width": 390, "height": 844})
        pg3 = ctx3.new_page()
        pg3.on("pageerror", lambda e: errors.append(str(e)))
        pg3.on("console", _note_console)
        serve_with_fallback(pg3, ctx3)
        pg3.goto(ONBOARDING_URL)
        pg3.wait_for_timeout(1200)
        check(
            pg3.get_by_test_id("role-split").count() > 0,
            "d1 welcome role split renders in a fresh context",
        )
        pg3.get_by_test_id("role-split-partner").click()
        pg3.wait_for_timeout(500)
        check(
            pg3.get_by_test_id("code-entry").count() > 0,
            "d1 partner role opens the code entry screen",
        )
        code_in = pg3.get_by_test_id("code-entry-input")
        name_in = pg3.get_by_test_id("code-entry-name")
        verify = pg3.get_by_test_id("code-entry-verify")
        check(
            verify.get_attribute("aria-disabled") == "true",
            "d1 verify is quiet until name and code are both complete",
        )
        # Auto-caps: typed lowercase becomes uppercase.
        code_in.fill("ab2kxd")
        pg3.wait_for_timeout(300)
        check(code_in.input_value() == "AB2KXD", "d2 code input auto-capitalizes")
        check(
            verify.get_attribute("aria-disabled") == "true",
            "d2 code alone does not enable verify (name is required)",
        )
        name_in.fill("Sam")
        pg3.wait_for_timeout(300)
        check(
            verify.get_attribute("aria-disabled") != "true",
            "d2 verify enables once name and 6 valid characters are set",
        )
        # The stubbed backend returns invalid_code: the warm invalid message
        # shows — never a crash, never an expiry state.
        verify.click()
        pg3.wait_for_timeout(3000)
        err = pg3.get_by_test_id("code-entry-error")
        check(err.count() > 0, "d2 invalid pair shows the warm error")
        check(
            "didn't work" in (err.first.inner_text() or ""),
            "d2 error copy is the approved invalid-only message",
        )
        # Back returns to the role split.
        pg3.get_by_test_id("code-entry-back").click()
        pg3.wait_for_timeout(500)
        check(
            pg3.get_by_test_id("role-split").count() > 0,
            "d2 back returns to the role split",
        )

        # d3: a valid name+code connects; Done keeps the partner on the connected
        # screen (the resting state) — never the role split, never Week.
        pg3.get_by_test_id("role-split-partner").click()
        pg3.wait_for_timeout(500)
        pg3.get_by_test_id("code-entry-name").fill("Sam")
        pg3.get_by_test_id("code-entry-input").fill("ABCDEF")
        pg3.get_by_test_id("code-entry-verify").click()
        pg3.get_by_test_id("partner-connected").wait_for(timeout=10000)
        check(
            "You're connected" in (pg3.get_by_test_id("partner-connected").inner_text() or ""),
            "d3 valid code shows the connected confirmation",
        )
        pg3.get_by_test_id("partner-connected-done").click()
        pg3.wait_for_timeout(800)
        check(
            pg3.get_by_test_id("partner-connected").count() > 0
            and pg3.get_by_test_id("role-split").count() == 0,
            "d3 Done stays on the connected screen (no re-ask loop)",
        )
        pg3.goto(ONBOARDING_URL)
        pg3.wait_for_timeout(1500)
        check(
            pg3.get_by_test_id("partner-connected").count() > 0,
            "d3 relaunch returns straight to the connected screen",
        )
        # ----------------------------------------------------------------
        # E. Verify gating: short / ambiguous codes stay disabled.
        # (Fresh context — pg3 is a linked partner now, past the split.)
        # ----------------------------------------------------------------
        ctx4 = browser.new_context(viewport={"width": 390, "height": 844})
        pg4 = ctx4.new_page()
        pg4.on("pageerror", lambda e: errors.append(str(e)))
        pg4.on("console", _note_console)
        serve_with_fallback(pg4, ctx4)
        pg4.goto(ONBOARDING_URL)
        pg4.wait_for_timeout(1200)
        pg = pg4
        ctx = ctx4

        pg.get_by_test_id("role-split-partner").click()
        pg.wait_for_timeout(500)
        code_in = pg.get_by_test_id("code-entry-input")
        verify = pg.get_by_test_id("code-entry-verify")
        # Fill the name first so the checks below exercise the code gating,
        # not the name gating.
        pg.get_by_test_id("code-entry-name").fill("Sam")
        code_in.fill("AB0")
        pg.wait_for_timeout(300)
        check(
            verify.get_attribute("aria-disabled") == "true",
            "e1 short code keeps verify disabled",
        )
        code_in.fill("AB01CD")  # 0/1 are ambiguous - never valid
        pg.wait_for_timeout(300)
        check(
            verify.get_attribute("aria-disabled") == "true",
            "e1 ambiguous characters keep verify disabled",
        )
        code_in.fill("AB2KXD")
        pg.wait_for_timeout(300)
        check(
            verify.get_attribute("aria-disabled") != "true",
            "e1 six unambiguous characters enable verify",
        )

# F. You tab: edit all four Account rows (fresh context, clean slate).
        # ----------------------------------------------------------------
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
        pg2 = ctx2.new_page()
        pg2.on("pageerror", lambda e: errors.append(str(e)))
        pg2.on("console", _note_console)
        serve_with_fallback(pg2, ctx2)
        pg = pg2
        ctx = ctx2
        today = datetime.date.today()
        due1 = (today + datetime.timedelta(days=112)).isoformat()  # week 24, day 0
        due2 = (today + datetime.timedelta(days=119)).isoformat()  # week 23
        pg.evaluate(
            f"""(() => {{
              const t = window.__nurtureTest;
              t.completeOnboarding();
              t.seedPregnancy({{ dueDate: '{due1}', ownerName: 'Priya', dob: '1990-04-12' }});
            }})()"""
        )
        pg.goto(BASE)
        pg.wait_for_timeout(1200)
        pg.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        pg.get_by_role("tab", name="You").click()
        pg.wait_for_timeout(800)

        check(
            pg.get_by_text("Week 25").count() > 0,
            "f1 seeded due date computes week 25",
        )
        check(pg.get_by_test_id("account-name-row").count() > 0, "f1 account rows render")
        check(pg.get_by_test_id("account-due-date-row").count() > 0, "f1 due date row renders")
        check(pg.get_by_test_id("account-dob-row").count() > 0, "f1 birthday row renders")

        # Her name.
        pg.get_by_test_id("account-name-row").click()
        pg.get_by_test_id("account-name-input").fill("Maya")
        pg.get_by_test_id("account-name-save").click()
        pg.wait_for_timeout(500)
        check(pg.get_by_text("Maya").count() > 0, "f2 name edit updates the row")

        # Due date: week recomputes.
        pg.get_by_test_id("account-due-date-row").click()
        pg.get_by_test_id("account-due-date-picker").fill(due2)
        pg.get_by_test_id("account-due-date-save").click()
        pg.wait_for_timeout(500)
        check(pg.get_by_text("Week 24").count() > 0, "f3 due date edit recomputes the week line")

        # Birthday.
        pg.get_by_test_id("account-dob-row").click()
        pg.get_by_test_id("account-dob-picker").fill("1988-11-03")
        pg.get_by_test_id("account-dob-save").click()
        pg.wait_for_timeout(500)
        check(
            pg.get_by_text("Nov 3, 1988").count() > 0,
            "f4 birthday edit updates the row",
        )

        # Baby's name (the row moved into the Account section).
        pg.get_by_test_id("baby-name-row").click()
        pg.get_by_test_id("baby-name-input").fill("Wren")
        pg.get_by_test_id("baby-name-save").click()
        pg.wait_for_timeout(500)
        check(pg.get_by_text("Wren").count() > 0, "f5 baby name row still saves")

        # Persistence across a reboot.
        pg.goto(BASE)
        pg.wait_for_timeout(1200)
        pg.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        pg.get_by_role("tab", name="You").click()
        pg.wait_for_timeout(800)
        check(pg.get_by_text("Maya").count() > 0, "f6 name persists")
        check(pg.get_by_text("Week 24").count() > 0, "f6 due date persists")
        check(pg.get_by_text("Nov 3, 1988").count() > 0, "f6 birthday persists")
        check(pg.get_by_text("Wren").count() > 0, "f6 baby's name persists")

        # The You tab row opens the partners-list sheet (mockup 33 rev C,
        # named-invite revision: the row reads "Your partners").
        row = pg.get_by_test_id("partner-sharing-row")
        check(
            "Your partners" in (row.inner_text() or ""),
            "f7 row reads Your partners",
        )
        row.click()
        try:
            pg.get_by_test_id("partner-sheet").wait_for(timeout=10000)
            check(True, "f7 row opens the partners-list sheet")
        except Exception:
            check(False, "f7 row opens the partners-list sheet")
        try:
            pg.get_by_test_id("partners-list-not-ready").wait_for(timeout=15000)
            check(True, "f7 sheet degrades gracefully without the backend")
        except Exception:
            check(False, "f7 sheet degrades gracefully without the backend")
        check(
            pg.get_by_test_id("partners-list-add").count() == 0,
            "f7 no Add button while the backend isn't ready",
        )
        pg.get_by_test_id("partners-list-back").click()
        pg.wait_for_timeout(500)

        browser.close()

    check(len(errors) == 0, f"no page errors ({len(errors)} seen)")
    for e in errors[:10]:
        print("  pageerror:", e[:300])
    if failures:
        print(f"\n{len(failures)} FAILURES")
        sys.exit(1)
    print("\nonboarding_sharing: all checks passed")


if __name__ == "__main__":
    main()
