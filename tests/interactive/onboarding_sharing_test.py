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
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        serve_with_fallback(pg, ctx)

        # ----------------------------------------------------------------
        # A. Screen 1: required name, disabled Continue, gentle hint.
        # ----------------------------------------------------------------
        pg.goto(ONBOARDING_URL)
        pg.wait_for_timeout(1200)
        pg.get_by_test_id("onboarding-get-started").click()

        check(
            pg.get_by_test_id("onboarding-owner-name").count() > 0
            and pg.get_by_text("Just the basics").count() > 0,
            "a1 profile screen renders",
        )
        cont = pg.get_by_test_id("onboarding-profile-continue")
        check(cont.get_attribute("aria-disabled") == "true", "a1 continue disabled with empty name")
        check(
            pg.get_by_test_id("onboarding-continue-hint").count() > 0,
            "a1 gentle hint visible",
        )
        pg.get_by_test_id("onboarding-owner-name").fill("Priya")
        check(cont.get_attribute("aria-disabled") != "true", "a1 continue enables once name + valid date present")
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
        # B. Screen 2: the exact headline, Skip moves on with no invite.
        # ----------------------------------------------------------------
        headline = pg.get_by_text("Want to share this journey with your partner and family?")
        check(headline.count() > 0, "b2 share screen headline renders")
        pg.get_by_test_id("onboarding-share-skip").click()
        check(
            pg.get_by_text("A couple of quick things").count() > 0,
            "b2 skip lands on the quick-things screen",
        )
        check(
            pg.evaluate("window.__nurtureTest && window.__nurtureTest.lastInviteShare") is None,
            "b2 skip creates no invite",
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
        # D. Email path: Epic 7 invite + link card on web.
        # ----------------------------------------------------------------
        pg.goto(ONBOARDING_URL)
        pg.wait_for_timeout(1200)
        pg.get_by_test_id("onboarding-get-started").click()
        pg.get_by_test_id("onboarding-owner-name").fill("Priya")
        pg.get_by_test_id("onboarding-profile-continue").click()
        pg.get_by_test_id("onboarding-share-contact").fill("ana@example.com")
        check(pg.get_by_text("Email").first.count() > 0, "d1 email auto-detected")
        pg.get_by_test_id("onboarding-share-send").click()
        pg.wait_for_timeout(600)
        share = pg.evaluate("window.__nurtureTest && window.__nurtureTest.lastInviteShare")
        check(share is not None, "d1 submit records a share target")
        check(
            share is not None and share.get("kind") == "web-link",
            "d1 web degrades to the link handoff",
        )
        check(
            share is not None and str(share.get("target", "")).startswith("https://nurture.app/join/"),
            "d1 invite URL is a real Epic 7 invite link",
        )
        card = pg.get_by_test_id("onboarding-share-link")
        check(card.count() > 0, "d1 link card shown on web")
        check(
            card.count() > 0 and str(share.get("target", "")) in (card.first.inner_text() or ""),
            "d1 link card carries the invite link",
        )
        pg.get_by_test_id("onboarding-share-copy").click()
        pg.wait_for_timeout(300)
        check(
            pg.get_by_test_id("onboarding-share-note").count() > 0,
            "d1 copy affordance responds",
        )
        pg.get_by_test_id("onboarding-share-continue").click()
        pg.get_by_test_id("onboarding-chips-continue").click()
        pg.get_by_test_id("onboarding-notifications-skip").click()
        pg.get_by_test_id("onboarding-finish").click()
        pg.wait_for_timeout(1500)

        # The Epic 7 invite is live in the You tab's partner row.
        pg.get_by_role("tab", name="You").click()
        pg.wait_for_timeout(800)
        check(
            pg.get_by_text("Invite sent — waiting for your partner").count() > 0,
            "d1 partner row shows the Epic 7 invite state",
        )

        # ----------------------------------------------------------------
        # E. Phone + invalid contact paths.
        # ----------------------------------------------------------------
        pg.goto(ONBOARDING_URL)
        pg.wait_for_timeout(1200)
        pg.get_by_test_id("onboarding-get-started").click()
        pg.get_by_test_id("onboarding-owner-name").fill("Priya")
        pg.get_by_test_id("onboarding-profile-continue").click()
        # Invalid first: send stays disabled while the contact is malformed.
        pg.get_by_test_id("onboarding-share-contact").fill("notanemail@")
        check(
            pg.get_by_test_id("onboarding-share-send").get_attribute("aria-disabled") == "true",
            "e1 invalid contact keeps send disabled",
        )
        pg.get_by_test_id("onboarding-share-contact").fill("+1 415-555-0132")
        check(pg.get_by_text("Phone number").first.count() > 0, "e1 phone auto-detected")
        pg.get_by_test_id("onboarding-share-send").click()
        pg.wait_for_timeout(600)
        phone_share = pg.evaluate("window.__nurtureTest && window.__nurtureTest.lastInviteShare")
        check(
            phone_share is not None
            and str(phone_share.get("target", "")).startswith("https://nurture.app/join/"),
            "e1 phone path still mints the Epic 7 invite link",
        )

        # ----------------------------------------------------------------
        # F. You tab: edit all four Account rows (fresh context, clean slate).
        # ----------------------------------------------------------------
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
        pg2 = ctx2.new_page()
        pg2.on("pageerror", lambda e: errors.append(str(e)))
        pg2.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
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
            pg.get_by_text("Week 24").count() > 0,
            "f1 seeded due date computes week 24",
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
        check(pg.get_by_text("Week 23").count() > 0, "f3 due date edit recomputes the week line")

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
        check(pg.get_by_text("Week 23").count() > 0, "f6 due date persists")
        check(pg.get_by_text("Nov 3, 1988").count() > 0, "f6 birthday persists")
        check(pg.get_by_text("Wren").count() > 0, "f6 baby's name persists")

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
