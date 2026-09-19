"""Captures the required screenshots for the onboarding worker report.

- screen1-empty.png: Screen 1 with the gentle hint, Continue disabled.
- screen1-filled.png: name + birthday picked.
- screen2-share.png: the partner/family invite screen.
- you-account.png: the You tab Account section with all four rows.

Saves to .screenshots/ (uncommitted). Run with:
    python3 tests/interactive/capture_screenshots.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from onboarding_sharing_test import launch_browser, serve_with_fallback, ONBOARDING_URL  # noqa: E402

from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOT_DIR = os.path.join(REPO, ".screenshots")
os.makedirs(SHOT_DIR, exist_ok=True)


def main() -> None:
    with sync_playwright() as p:
        browser = launch_browser(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        serve_with_fallback(pg, ctx)

        # Screen 1: empty + filled.
        pg.goto(ONBOARDING_URL)
        pg.wait_for_timeout(1200)
        pg.get_by_test_id("onboarding-get-started").click()
        pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(SHOT_DIR, "screen1-empty.png"))

        pg.get_by_test_id("onboarding-owner-name").fill("Priya")
        pg.get_by_test_id("onboarding-dob-add").click()
        pg.get_by_test_id("onboarding-dob-picker").fill("1990-04-12")
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(SHOT_DIR, "screen1-filled.png"))

        # Screen 2: share.
        pg.get_by_test_id("onboarding-profile-continue").click()
        pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(SHOT_DIR, "screen2-share.png"))

        # You tab: account section (seeded so every row has a value).
        pg.evaluate(
            """(() => {
              const t = window.__nurtureTest;
              t.completeOnboarding();
              t.seedPregnancy({ dueDate: '2026-12-19', ownerName: 'Priya', dob: '1990-04-12' });
            })()"""
        )
        pg.goto("https://nurture.test/willow/?testhooks=1")
        pg.wait_for_timeout(1500)
        pg.get_by_role("tab", name="You").click()
        pg.wait_for_timeout(800)
        # Set the baby's name through the sheet so all four rows show values.
        pg.get_by_test_id("baby-name-row").click()
        pg.get_by_test_id("baby-name-input").fill("Wren")
        pg.get_by_test_id("baby-name-save").click()
        pg.wait_for_timeout(500)
        # Scroll the account rows into view before shooting.
        pg.get_by_test_id("account-name-row").scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(SHOT_DIR, "you-account.png"))

        browser.close()
    print("screenshots saved to", SHOT_DIR)


if __name__ == "__main__":
    main()
