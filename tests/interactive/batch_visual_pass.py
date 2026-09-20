#!/usr/bin/env python3
"""390x844 visual/interaction pass for the Willow evening batch.

Covers the batch's visible surfaces:
1. Week tab: "Coming up" card (kicker + "2 questions to ask"), tap -> editor.
2. Logs tab: report summary card shows exactly "This isn't medical advice.";
   interim "Summarizing your report..." entry shows it too.
3. Logs composer: dummy [+] tap -> "Photo uploads are paused for now" toast,
   no attach sheet opens, nothing attaches.
4. You tab: reminders cleanup (no global "Remind me" card, no "Set it once").
5. Zero page errors throughout.

Saves screenshots to .screenshots/batch/.
Run: python3 tests/interactive/batch_visual_pass.py
"""
import os, sys, mimetypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(REPO, "dist")
SHOT_DIR = os.path.join(REPO, ".screenshots", "batch")
os.makedirs(SHOT_DIR, exist_ok=True)

ORIGIN = "https://willow.test"
WEEK = ORIGIN + "/willow/week?testhooks=1"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
YOU = ORIGIN + "/willow/you?testhooks=1"

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

def serve_dist(route):
    url = route.request.url
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
    route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")

SEED = """() => {
  const t = window.__nurtureTest;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  const now = new Date();
  const appt = new Date(now); appt.setDate(appt.getDate() + 1); appt.setHours(10, 30, 0, 0);
  t.seedEvent({ type: 'appointment', occurredAt: appt.toISOString(),
    data: { title: 'Growth scan', provider: 'Dr. Izu', questions: ['q1','q2'] } });
  t.seedEvent({ type: 'report', occurredAt: now.toISOString(),
    data: { reportSummary: { status: 'ready', title: 'Growth scan summary',
      summary: 'Baby is growing well. Everything looks normal.',
      attachmentName: 'scan.pdf', needsAttention: false, disclaimer: '' } } });
  t.seedEvent({ type: 'report', occurredAt: now.toISOString(),
    data: { reportSummary: { status: 'summarizing' } } });
}"""

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"))
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(ORIGIN + "/**", serve_dist)

        # --- Week tab: Coming up card ---
        # Seed first, then (re)navigate so the tab picks up the events.
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED)
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_timeout(2500)
        cards = page.get_by_test_id("week-reminder-card")
        check("week: one 'Coming up' card renders", cards.count() == 1)
        card_text = cards.first.inner_text().lower() if cards.count() >= 1 else ""
        check("week: kicker is 'Coming up' (locked copy)", "coming up" in card_text)
        check("week: body is '2 questions to ask' (locked copy)", "2 questions to ask" in card_text)
        check("week: no reminder-lead-time text on card",
              "reminder 2 days before" not in card_text)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-coming-up.png"))
        # tap the card -> appointment editor
        cards.first.click()
        page.wait_for_timeout(1500)
        check("week: tapping card opens appointment editor",
              page.get_by_test_id("appointment-editor").count() >= 1)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-appointment-editor.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # --- Logs tab: report cards + dummy [+] ---
        # (re)seed on the Logs route so the feed picks up the report events.
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED)
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_timeout(2500)
        disclaimers = page.get_by_text("This isn't medical advice.", exact=True).count()
        check("logs: disclaimer on ready + interim/failed cards (>=2)", disclaimers >= 2)
        # The seeded 'summarizing' entry may flip to 'failed' on mount (no
        # stashed bytes); either way it must carry the fixed disclaimer.
        interim = (page.get_by_text("Summarizing your report").count() +
                   page.get_by_text("Couldn't read this one").count())
        check("logs: interim/failed report entry visible", interim >= 1)
        check("logs: no old 'Not medical advice' wording",
              page.get_by_text("Not medical advice").count() == 0)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-report-cards.png"), full_page=True)

        # dummy [+] : open Add menu -> Log entry, tap [+] -> paused toast, no sheet
        add_btn = page.get_by_role("button", name="Add").first
        if add_btn.count() == 0:
            add_btn = page.get_by_test_id("logs-add-button")
        add_btn.first.click()
        page.wait_for_timeout(800)
        page.get_by_text("Log entry").first.click()
        page.wait_for_timeout(1200)
        plus = page.get_by_role("button", name="Add photo")
        check("logs: composer [+] visible", plus.count() >= 1)
        plus.first.click()
        page.wait_for_timeout(800)
        check("logs: 'Photo uploads are paused for now' shown",
              page.get_by_text("Photo uploads are paused for now").count() >= 1)
        check("logs: no attach sheet opened",
              page.get_by_text("Add a photo").count() == 0 and
              page.get_by_text("Take a photo").count() == 0)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-photo-paused.png"))

        # --- You tab: reminders cleanup ---
        page.goto(YOU, wait_until="networkidle")
        page.wait_for_timeout(2500)
        check("you: no global 'Remind me' lead-time card",
              page.get_by_text("Remind me").count() == 0)
        check("you: no 'Set it once' helper text",
              page.get_by_text("Set it once").count() == 0)
        check("you: End-of-day nudge present",
              page.get_by_text("End-of-day nudge").count() >= 1)
        check("you: Nudge time present",
              page.get_by_text("Nudge time").count() >= 1)
        page.screenshot(path=os.path.join(SHOT_DIR, "you-reminders.png"), full_page=True)

        check("zero page errors", len(errors) == 0)
        for e in errors[:5]:
            print("  pageerror:", e[:200])
        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\nbatch visual pass: {len(results)-len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
