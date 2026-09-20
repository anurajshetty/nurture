#!/usr/bin/env python3
"""Interactive test: mockup-18 delete appointment (Anuraj, Sept 19, 2026).

The Logs appointment card carries a small x in its top-right corner (44x44
hit area). Tapping it opens a confirmation dialog with the exact spec copy;
confirming deletes the appointment from the feed AND the Week "Coming up"
card, shows an "Appointment deleted" toast, and offers no undo. Scrim tap
and "Keep it" dismiss without deleting. Tapping the x must NOT open the
questions sheet.

Drives the REAL Willow web UI in real Chromium (390x844) against dist/
served under /willow/ via Playwright route interception.

Checks (all real UI, no stubs):
  1. Logs: x present on the appointment card, 44x44, top-right of the card.
  2. Tap x -> confirmation dialog with EXACT copy; the questions sheet
     does NOT open (tap isolation).
  3. Scrim tap dismisses; the card is still there.
  4. x again -> "Keep it" dismisses; the card is still there.
  5. x again -> "Delete" -> "Appointment deleted" toast (no undo), the
     card leaves the Logs feed.
  6. Week: the "Coming up" card is gone.
  7. Zero page errors throughout.

Run:  python3 tests/interactive/appointment_delete_test.py [--keep-open]
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
LOGS_URL = ORIGIN + "/willow/logs?testhooks=1"
WEEK_URL = ORIGIN + "/willow/week?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    with open(fpath, "rb") as f:
        body = f.read()
    route.fulfill(status=200, body=body,
                  content_type=ctype or "application/octet-stream")


SEED_PREGNANCY_JS = """() => {
  const t = window.__nurtureTest;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
}"""


SEED_APPT_JS = """() => {
  const t = window.__nurtureTest;
  t.clearEvents();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 30, 0, 0);
  const ev = t.seedEvent({
    type: 'appointment',
    occurredAt: d.toISOString(),
    data: {
      title: 'Growth scan',
      provider: 'Dr. Izu',
      questions: [
        { id: 'q1', text: 'Ask about the birth plan', state: 'to_ask' },
      ],
    },
  });
  return ev.id;
}"""


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(ORIGIN + "/**", serve_dist)

        print("Boot -> seed pregnancy + appointment")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED_PREGNANCY_JS)
        appt_id = page.evaluate(SEED_APPT_JS)
        page.wait_for_timeout(500)

        card_tid = f"event-card-{appt_id}"
        del_tid = f"event-card-delete-{appt_id}"

        # --- 1. x present, 44x44, top-right -------------------------------
        print("Logs -> inspect delete x")
        page.goto(LOGS_URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        card = page.get_by_test_id(card_tid)
        card.wait_for(timeout=15000)
        xbtn = page.get_by_test_id(del_tid)
        check("delete x present on Logs card", xbtn.count() == 1)
        cbox = card.bounding_box()
        xbox = xbtn.bounding_box()
        check("x hit area 44x44",
              xbox is not None and abs(xbox["width"] - 44) < 2
              and abs(xbox["height"] - 44) < 2)
        check("x top-right of card",
              xbox is not None and cbox is not None
              and abs((cbox["x"] + cbox["width"]) - (xbox["x"] + xbox["width"]) - 6) < 4
              and abs(xbox["y"] - cbox["y"] - 6) < 4)
        page.screenshot(path="/tmp/appt-delete-x-390x844.png")

        # --- 2. tap x -> dialog, NOT the questions sheet ------------------
        print("Tap x -> confirmation dialog")
        xbtn.click()
        page.get_by_test_id("delete-appointment-dialog").wait_for(timeout=10000)
        page.wait_for_timeout(500)
        dlg = page.get_by_test_id("delete-appointment-dialog")
        dlg_text = " ".join(dlg.inner_text().split())
        check("dialog title exact",
              "Delete this appointment?" in dlg_text)
        check("dialog body exact",
              "It'll disappear from your feed and your Week. "
              "This can't be undone." in dlg_text)
        check("Delete button", page.get_by_test_id(
            "delete-appointment-confirm").count() == 1)
        check("Keep it button", page.get_by_test_id(
            "delete-appointment-keep").count() == 1)
        check("x tap does NOT open the questions sheet",
              page.get_by_test_id("appointment-editor").count() == 0)
        page.screenshot(path="/tmp/appt-delete-dialog-390x844.png")

        # --- 3. scrim tap dismisses ---------------------------------------
        print("Scrim tap dismisses")
        page.get_by_test_id("delete-appointment-scrim").click(
            position={"x": 20, "y": 20})
        page.wait_for_timeout(600)
        check("scrim dismisses dialog",
              page.get_by_test_id("delete-appointment-dialog").count() == 0)
        check("card still present after scrim dismiss",
              page.get_by_test_id(card_tid).count() == 1)

        # --- 4. Keep it dismisses -----------------------------------------
        print("Keep it dismisses")
        page.get_by_test_id(del_tid).click()
        page.get_by_test_id("delete-appointment-dialog").wait_for(timeout=10000)
        page.get_by_test_id("delete-appointment-keep").click()
        page.wait_for_timeout(600)
        check("Keep it dismisses dialog",
              page.get_by_test_id("delete-appointment-dialog").count() == 0)
        check("card still present after Keep it",
              page.get_by_test_id(card_tid).count() == 1)

        # --- 5. Delete -> toast, card gone ---------------------------------
        print("Delete confirms")
        page.get_by_test_id(del_tid).click()
        page.get_by_test_id("delete-appointment-dialog").wait_for(timeout=10000)
        page.get_by_test_id("delete-appointment-confirm").click()
        page.wait_for_timeout(600)
        toast = page.get_by_test_id("delete-appointment-toast")
        check("toast appears", toast.count() == 1)
        toast_text = " ".join(toast.inner_text().split())
        check("toast copy exact", toast_text == "Appointment deleted")
        check("no undo offered", "Undo" not in toast_text)
        check("dialog closes on confirm",
              page.get_by_test_id("delete-appointment-dialog").count() == 0)
        page.wait_for_timeout(2500)
        check("card gone from Logs feed",
              page.get_by_test_id(card_tid).count() == 0)
        check("delete x gone with the card",
              page.get_by_test_id(del_tid).count() == 0)
        page.screenshot(path="/tmp/appt-deleted-toast-390x844.png")

        # --- 6. Week: Coming-up card gone ----------------------------------
        print("Week -> Coming up card gone")
        page.goto(WEEK_URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        check("Coming up card gone from Week",
              page.get_by_test_id("week-reminder-card").count() == 0)

        # --- 7. page errors -------------------------------------------------
        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors:
                print("PAGEERROR:", e)

        fails = [n for n, ok in results if not ok]
        print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
        if KEEP_OPEN:
            page.wait_for_timeout(3600_000)
        browser.close()
        sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
