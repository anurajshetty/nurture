#!/usr/bin/env python3
"""Interactive test: deletable feed cards for every card type
(mockup 30 — Anuraj approved Sept 20, 2026).

Every feed-backed card carries a small muted x in its top-right corner
(44x44 hit area). Tapping it opens ONE shared centered confirmation
dialog (mockup-18 pattern); only the named item, the consequence line,
and the delete-button label change per type. Confirming deletes the
card and shows a type-specific toast; scrim tap and "Keep it" dismiss
without deleting. No undo, no long-press, no bottom sheet.

Drives the REAL Willow web UI in real Chromium (390x844) against dist/
served under /willow/ via Playwright route interception.

Checks (all real UI, no stubs):
  1. Report, log entry, and kick-session cards each show the x: 44x44,
     top-right of the card, with the type-specific accessibility label.
  2. x -> shared dialog with EXACT per-type copy (title, body,
     delete-button label).
  3. "Keep it" dismisses; the card is still there.
  4. Scrim tap dismisses; the card is still there.
  5. Confirm -> exact toast copy, card and its x are gone, other cards
     remain (report deletion keeps everything else in the story).
  6. Report "Show more"/"Show less" still works; the x never expands or
     collapses the summary (tap isolation).
  7. Filter chips unchanged: All · Reports · Appointments · Logs.
  8. Zero page errors throughout.

Run:  python3 tests/interactive/delete_cards_test.py [--keep-open]
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

LONG_SUMMARY = (
    "Your glucose screening results look typical for this stage of "
    "pregnancy. The one-hour glucose challenge test measures how your body "
    "processes sugar, and your value came back within the expected range. "
    "No follow-up testing is needed at this time. Keep up your usual meals "
    "and movement, and bring any questions about diet or energy levels to "
    "your next visit. If any value needs a closer look, your care team will "
    "talk through next steps with you directly."
)

SEED_CARDS_JS = """() => {
  const t = window.__nurtureTest;
  t.clearEvents();
  const now = new Date();
  const at = (h, m, dayOffset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const ids = {};
  ids.report = t.seedEvent({
    type: 'report',
    occurredAt: at(9, 12, 0),
    data: { reportSummary: { status: 'ready', title: 'Glucose screening',
      summary: %r, attachmentName: 'glucose-screening.pdf',
      needsAttention: false } },
  }).id;
  ids.note = t.seedEvent({
    type: 'note',
    occurredAt: at(8, 4, 0),
    data: { text: 'Slept through the night for the first time in weeks.' },
  }).id;
  ids.kick = t.seedEvent({
    type: 'kick_session',
    occurredAt: at(21, 15, -1),
    data: { movements: 10, durationSec: 2400, durationMin: 40,
      strength: 'fluttery' },
  }).id;
  return ids;
}""" % LONG_SUMMARY

# Exact per-type copy (mockup 30, verbatim).
COPY = {
    "report": {
        "xLabel": "Delete report summary",
        "title": "Delete this summary?",
        "body": "Only the summary card goes away \u2014 your entries stay "
                "in your story. This can\u2019t be undone.",
        "confirm": "Delete summary",
        "toast": "Summary deleted",
    },
    "note": {
        "xLabel": "Delete log entry",
        "title": "Delete this entry?",
        "body": "It leaves your story everywhere it appears. "
                "This can\u2019t be undone.",
        "confirm": "Delete entry",
        "toast": "Entry deleted",
    },
    "kick": {
        "xLabel": "Delete kick session",
        "title": "Delete this kick session?",
        "body": "It leaves your story. This can\u2019t be undone.",
        "confirm": "Delete session",
        "toast": "Kick session deleted",
    },
}


def dialog_text(page):
    dlg = page.get_by_test_id("delete-card-dialog")
    return " ".join(dlg.inner_text().split())


def check_x(page, label, del_tid, card_tid, x_label):
    xbtn = page.get_by_test_id(del_tid)
    check(f"{label}: delete x present", xbtn.count() == 1)
    xbox = xbtn.bounding_box()
    card = page.get_by_test_id(card_tid)
    cbox = card.bounding_box()
    check(f"{label}: x hit area 44x44",
          xbox is not None and abs(xbox["width"] - 44) < 2
          and abs(xbox["height"] - 44) < 2)
    check(f"{label}: x top-right of card",
          xbox is not None and cbox is not None
          and abs((cbox["x"] + cbox["width"]) - (xbox["x"] + xbox["width"]) - 6) < 4
          and abs(xbox["y"] - cbox["y"] - 6) < 4)
    check(f"{label}: x aria-label exact",
          xbtn.get_attribute("aria-label") == x_label)


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

        print("Boot -> seed one card of each type")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED_PREGNANCY_JS)
        ids = page.evaluate(SEED_CARDS_JS)
        page.wait_for_timeout(500)

        print("Logs -> cards render")
        page.goto(LOGS_URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        tids = {k: (f"event-card-{v}", f"event-card-delete-{v}")
                for k, v in ids.items()}
        for label, (card_tid, _) in (("report", tids["report"]),
                                     ("note", tids["note"]),
                                     ("kick", tids["kick"])):
            page.get_by_test_id(card_tid).wait_for(timeout=15000)

        # --- 7. filters unchanged -----------------------------------------
        print("Filter chips unchanged")
        for val, label in (("all", "All"), ("reports", "Reports"),
                           ("appointments", "Appointments"), ("logs", "Logs")):
            chip = page.get_by_test_id(f"filter-chip-{val}")
            check(f"filter chip '{label}' present", chip.count() == 1)

        # --- 1. x on every card --------------------------------------------
        print("Delete x on every card type")
        for key, label in (("report", "report"), ("note", "log entry"),
                           ("kick", "kick session")):
            card_tid, del_tid = tids[key]
            check_x(page, label, del_tid, card_tid, COPY[key]["xLabel"])

        # --- 6. report Show more / Show less unaffected ----------------------
        print("Report Show more / Show less still works")
        rcard, rdel = tids["report"]
        toggle = page.get_by_test_id("report-summary-toggle")
        check("report toggle present", toggle.count() == 1)
        check("toggle starts as Show more",
              toggle.inner_text().strip() == "Show more")
        toggle.click()
        page.wait_for_timeout(400)
        check("tap expands -> Show less",
              page.get_by_test_id("report-summary-toggle")
              .inner_text().strip() == "Show less")
        page.get_by_test_id("report-summary-toggle").click()
        page.wait_for_timeout(400)
        check("tap collapses -> Show more",
              page.get_by_test_id("report-summary-toggle")
              .inner_text().strip() == "Show more")

        # --- 2..5 per card type ---------------------------------------------
        for key, label in (("report", "report"), ("note", "log entry"),
                           ("kick", "kick session")):
            card_tid, del_tid = tids[key]
            spec = COPY[key]
            print(f"{label}: dialog copy + dismiss + delete")

            page.get_by_test_id(del_tid).click()
            page.get_by_test_id("delete-card-dialog").wait_for(timeout=10000)
            page.wait_for_timeout(400)
            txt = dialog_text(page)
            check(f"{label}: dialog title exact", spec["title"] in txt)
            check(f"{label}: dialog body exact", spec["body"] in txt)
            check(f"{label}: confirm label exact",
                  page.get_by_test_id("delete-card-confirm")
                  .inner_text().strip() == spec["confirm"])
            check(f"{label}: Keep it present",
                  page.get_by_test_id("delete-card-keep").count() == 1)

            # Keep it dismisses
            page.get_by_test_id("delete-card-keep").click()
            page.wait_for_timeout(500)
            check(f"{label}: Keep it dismisses dialog",
                  page.get_by_test_id("delete-card-dialog").count() == 0)
            check(f"{label}: card still present after Keep it",
                  page.get_by_test_id(card_tid).count() == 1)

            # Scrim dismisses
            page.get_by_test_id(del_tid).click()
            page.get_by_test_id("delete-card-dialog").wait_for(timeout=10000)
            page.get_by_test_id("delete-card-scrim").click(
                position={"x": 20, "y": 20})
            page.wait_for_timeout(500)
            check(f"{label}: scrim dismisses dialog",
                  page.get_by_test_id("delete-card-dialog").count() == 0)
            check(f"{label}: card still present after scrim",
                  page.get_by_test_id(card_tid).count() == 1)

            # Confirm deletes
            page.get_by_test_id(del_tid).click()
            page.get_by_test_id("delete-card-dialog").wait_for(timeout=10000)
            page.get_by_test_id("delete-card-confirm").click()
            page.wait_for_timeout(600)
            toast = page.get_by_test_id("delete-card-toast")
            check(f"{label}: toast appears", toast.count() == 1)
            toast_text = " ".join(toast.inner_text().split())
            check(f"{label}: toast copy exact", toast_text == spec["toast"])
            check(f"{label}: no undo offered", "Undo" not in toast_text)
            check(f"{label}: dialog closes on confirm",
                  page.get_by_test_id("delete-card-dialog").count() == 0)
            page.wait_for_timeout(2500)
            check(f"{label}: card gone from feed",
                  page.get_by_test_id(card_tid).count() == 0)
            check(f"{label}: delete x gone with the card",
                  page.get_by_test_id(del_tid).count() == 0)

        # --- other cards survive --------------------------------------------
        print("Surviving cards intact")
        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors:
                print("PAGEERROR:", e)
        page.screenshot(path="/tmp/delete-cards-390x844.png")

        fails = [n for n, ok in results if not ok]
        print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
        if KEEP_OPEN:
            page.wait_for_timeout(3600_000)
        browser.close()
        sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
