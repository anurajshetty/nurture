#!/usr/bin/env python3
"""Interactive test: mockup-17 questions-only appointment editor (Anuraj, Sept 19, 2026).

The questions-only sheet now opens at EVERY entry point: tapping an
appointment card in the Logs feed AND the Week "Coming up" card open the
same sheet. The old full editor (visit heading, Notes, per-appointment
reminder timing) is RETIRED.

Drives the REAL Willow web UI in real Chromium (390x844) against dist/
served under /willow/ via Playwright route interception.

Checks (all real UI, no stubs):
  1. Logs: tap an appointment card -> questions-only sheet opens:
     "YOUR QUESTIONS" kicker, question rows with a x remove each,
     "+ Add a question", Save button. NO "Notes" kicker, NO "Reminder"
     kicker/row, NO reminder sheet, NO status pills (question-chip-*).
  2. Remove a question -> row disappears immediately.
  3. Add questions up to 5 -> add button disables, "That's 5" note shows.
  4. Save -> NO "Saved" toast/pill anywhere, sheet closes IMMEDIATELY,
     and the feed card now reads "5 questions to ask".
  5. Week: tap the "Coming up" card -> the SAME sheet opens.
  6. Feed story order (Sept 2026): two appointments seeded with crossed
     scheduled vs logged dates render newest-LOGGED first, and the
     appointment date sits at the card's right edge (positional check).
  7. Zero page errors throughout.

Run:  python3 tests/interactive/appointment_questions_test.py [--keep-open]
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
WEEK_URL = ORIGIN + "/willow/week?testhooks=1"
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
        { id: 'q2', text: 'Which prenatal class do you recommend?', state: 'to_ask' },
      ],
    },
  });
  return ev.id;
}"""


def open_sheet_from_logs(page):
    """Tap the Logs appointment card; returns when the sheet is open."""
    page.goto(LOGS_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)
    card = page.locator('[data-testid^="event-card-"]').first
    card.wait_for(timeout=15000)
    card.click()
    page.get_by_test_id("appointment-editor").wait_for(timeout=15000)
    page.wait_for_timeout(800)


def sheet_text(page):
    return page.get_by_test_id("appointment-editor").inner_text()


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
        page.evaluate(SEED_APPT_JS)
        page.wait_for_timeout(500)

        # --- 1. Logs card tap opens the questions-only sheet --------------
        print("Logs -> tap appointment card")
        open_sheet_from_logs(page)
        text = sheet_text(page)
        check("sheet opens from Logs card", True)
        check("YOUR QUESTIONS kicker", "YOUR QUESTIONS" in text)
        check("seeded question 1 visible", "Ask about the birth plan" in text)
        check("seeded question 2 visible", "Which prenatal class" in text)
        check("x remove per row",
              page.locator('[data-testid^="question-remove-"]').count() == 2)
        check("+ Add a question button",
              page.get_by_test_id("question-add").count() == 1)
        check("Save button", page.get_by_test_id("appointment-save").count() == 1)
        check("NO Notes kicker", "Notes" not in text)
        check("NO Reminder section", "Reminder" not in text)
        check("NO status pills", "question-chip-" not in text
              and "TO ASK" not in text)
        check("NO per-appointment timing UI",
              page.get_by_test_id("appointment-reminder-row").count() == 0
              and page.get_by_test_id("reminder-sheet").count() == 0)

        # --- 2. remove a question -----------------------------------------
        print("Remove one question")
        page.locator('[data-testid^="question-remove-"]').first.click()
        page.wait_for_timeout(600)
        text = sheet_text(page)
        check("one question removed",
              page.locator('[data-testid^="question-row-"]').count() == 1)
        check("removed question gone", "Ask about the birth plan" not in text)

        # --- 3. add up to the 5-max --------------------------------------
        print("Add questions to the 5-max")
        for i in range(4):
            page.get_by_test_id("question-add").click()
            page.get_by_test_id("question-input").fill(f"Extra question {i+1}")
            page.get_by_test_id("question-add-confirm").click()
            page.wait_for_timeout(500)
        text = sheet_text(page)
        check("5 questions total",
              page.locator('[data-testid^="question-row-"]').count() == 5)
        add_btn = page.get_by_test_id("question-add")
        check("add disabled at 5",
              add_btn.get_attribute("disabled") is not None
              or add_btn.get_attribute("aria-disabled") == "true")
        check("max note shows", "the max" in text)

        # --- 4. Save -> NO toast, immediate close, feed count updates ----
        # Anuraj, Sept 2026: the black "Saved" pill is removed; Save closes
        # the sheet immediately and the feed card picks up the new count.
        print("Save")
        page.get_by_test_id("appointment-save").click()
        page.wait_for_timeout(400)
        check("NO Saved toast/pill after save",
              "Saved" not in page.evaluate("document.body.innerText"))
        check("sheet closes immediately after save",
              page.get_by_test_id("appointment-editor").count() == 0)
        page.wait_for_timeout(1200)
        feed_text = page.evaluate("document.body.innerText")
        check("feed card shows 5 questions to ask",
              "5 questions to ask" in feed_text)

        # --- 5. Week Coming-up card opens the SAME sheet ------------------
        print("Week -> tap Coming up card")
        page.goto(WEEK_URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        card = page.get_by_test_id("week-reminder-card").first
        card.wait_for(timeout=15000)
        card.click()
        page.get_by_test_id("appointment-editor").wait_for(timeout=15000)
        page.wait_for_timeout(800)
        text = sheet_text(page)
        check("same sheet from Week card", "YOUR QUESTIONS" in text)
        check("Week sheet has questions",
              page.locator('[data-testid^="question-row-"]').count() == 5)
        check("Week sheet: no Reminder section", "Reminder" not in text)
        check("Week sheet: no Notes", "Notes" not in text)
        page.screenshot(path="/tmp/appt-questions-sheet-390x844.png")

        # --- 6. feed story order + date position -------------------------
        # A: scheduled +10 days, logged 2 days ago. B: scheduled +1 day,
        # logged just now. Feed must show B then A (newest-logged first),
        # and each appointment date must sit at the card's right edge.
        print("Feed story order: seed crossed scheduled/logged dates")
        page.evaluate("""() => {
          const t = window.__nurtureTest;
          t.clearEvents();
          const now = new Date();
          const aWhen = new Date(now);
          aWhen.setDate(aWhen.getDate() + 10);
          aWhen.setHours(10, 30, 0, 0);
          const a = t.seedEvent({
            type: 'appointment',
            occurredAt: aWhen.toISOString(),
            data: { title: 'Later visit', provider: 'Dr. Izu', questions: [] },
          });
          const twoDaysAgo = new Date(now);
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
          t.setCreatedAt(a.id, twoDaysAgo.toISOString());
          const bWhen = new Date(now);
          bWhen.setDate(bWhen.getDate() + 1);
          bWhen.setHours(9, 0, 0, 0);
          t.seedEvent({
            type: 'appointment',
            occurredAt: bWhen.toISOString(),
            data: { title: 'Soon visit', provider: 'Dr. Izu', questions: [] },
          });
        }""")
        page.goto(LOGS_URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        # Card pressables only: the [data-testid^="event-card-"] prefix also
        # matches sub-elements (date/questions/delete), so filter to the
        # pressables themselves via JS and read them in DOM (= feed) order.
        feed_texts = page.evaluate("""() => {
          const all = [...document.querySelectorAll('[data-testid^="event-card-"]')];
          const isSub = (el) => {
            const t = el.getAttribute('data-testid') || '';
            return t.startsWith('event-card-date-') || t.startsWith('event-card-questions-')
                || t.startsWith('event-card-delete-') || t === 'event-card-photo-placeholder';
          };
          return all.filter((el) => !isSub(el)).map((el) => el.innerText);
        }""")
        check("two appointment cards in feed", len(feed_texts) == 2)
        check("newest-logged appointment first (Soon visit)",
              "Soon visit" in feed_texts[0])
        check("older-logged appointment second (Later visit)",
              "Later visit" in feed_texts[1])
        # Positional: the date's right edge hugs the card's right edge.
        first_card = page.locator('[data-testid^="event-card-"]',
                                  has=page.locator('[data-testid^="event-card-date-"]')).first
        card_box = first_card.bounding_box()
        date_box = first_card.locator('[data-testid^="event-card-date-"]').bounding_box()
        card_right = card_box["x"] + card_box["width"]
        date_right = date_box["x"] + date_box["width"]
        check("appointment date at card right edge",
              card_right - date_right < 80
              and date_right > card_box["x"] + card_box["width"] * 0.5)
        page.screenshot(path="/tmp/appt-feed-order-390x844.png")

        # --- 7. zero page errors ------------------------------------------
        check("zero page errors", len(errors) == 0)
        if errors:
            for e in errors:
                print("   pageerror:", e[:200])

        fails = [n for n, ok in results if not ok]
        print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
        if KEEP_OPEN:
            page.wait_for_timeout(3600_000)
        browser.close()
        sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
