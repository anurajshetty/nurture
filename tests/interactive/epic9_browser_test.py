#!/usr/bin/env python3
"""
Epic 9 browser test: changed-outcome mode in real Chromium against the
production web export served under /nurture/ (with ?testhooks=1).

Verifies:
  1. Stop flow end-to-end (You tab): sheet -> "Stop tracking" -> "It's done."
     with the plain list of everything that stopped
  2. Data decisions expand-to-choose: expand row -> choose -> quiet decided
     state (check + label); decided row re-tappable to change
  3. Partner-memory row: "Shared memories with Alex", keep option -> decided
  4. Delete row -> gentle guard (cancel keeps story; confirm deletes)
  5. "I'll decide later" closes the sheet, everything stays private
  6. Afterwards Home: "Your story", timeline as memories, Gentle reads,
     zero developmental content, quiet note
  7. Week tab: quiet stopped state
  8. Zero page errors throughout

Run: python3 tests/interactive/epic9_browser_test.py
"""

import http.server
import socketserver
import threading
import os
import sys
import time

DIST = os.path.expanduser("~/workspace/epic9-work/dist")


def free_port():
    import socket as _socket
    s = _socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = free_port()
BASE = f"http://localhost:{PORT}/nurture/?testhooks=1"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        # Strip the /nurture subpath; SPA fallback to index.html
        path = self.path.split("?")[0]
        query = self.path[len(path):]
        if path.startswith("/nurture/"):
            rel = path[len("/nurture/"):]
            if not rel or not os.path.isfile(os.path.join(DIST, rel)):
                rel = "index.html"
            self.path = "/" + rel + query
        return super().do_GET()

    def log_message(self, *args):
        pass


def main():
    from playwright.sync_api import sync_playwright

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    passed, failed = 0, 0

    def check(cond, name):
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f"  ok: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))

        def tap(locator):
            """Scroll a sheet row into view (nested RN scroll container) then tap."""
            locator.evaluate("el => el.scrollIntoView({ block: 'center' })")
            page.wait_for_timeout(400)
            locator.click()
            page.wait_for_timeout(800)

        print("Loading app...")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(3000)

        # Seed: onboarding done, a pregnancy, two notes (one shared for the
        # partner-memory count).
        page.evaluate("""() => {
            window.__nurtureTest.completeOnboarding();
            window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
            window.__nurtureTest.seedEvent({ type: 'note', data: { text: 'first flutter' } });
            window.__nurtureTest.seedEvent({ type: 'note', data: { text: 'shared moment' }, visibility: 'shared' });
        }""")
        page.wait_for_timeout(1000)

        # ---- 1. Stop flow end-to-end (You tab) ----
        print("Stop flow...")
        page.goto(f"http://localhost:{PORT}/nurture/you?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(2500)

        page.get_by_text("Stop pregnancy tracking").first.click()
        page.wait_for_timeout(1200)
        check(page.get_by_text("Stop pregnancy tracking?").count() > 0,
              "stop sheet opens (choose phase)")

        page.locator('[data-testid="confirm-stop-button"]').click()
        page.wait_for_timeout(2000)
        check(page.get_by_text("It's done.").count() > 0, "\"It's done.\" state renders")
        check(page.get_by_text("stopped all pregnancy updates").count() > 0,
              "stop lede present")
        for item in ["Weekly development updates — off",
                     "Reminders and the end-of-day nudge — off",
                     "Pregnancy notifications to your partner — off",
                     "Celebratory messages — off, for good"]:
            check(page.locator('[data-testid="stopped-list"]').get_by_text(item).count() > 0,
                  f"stop list item: {item[:34]}…")
        check(page.get_by_text("Your story is still yours").count() > 0,
              "\"Your story is still yours\" kick present")

        # ---- 2. Expand-to-choose: keep row ----
        print("Data decisions...")
        keep_header = page.locator('[data-testid="data-row-story-keep-header"]')
        check(keep_header.count() > 0, "keep row present")
        keep_header.click()
        page.wait_for_timeout(800)
        check(page.locator('[data-testid="data-row-story-keep-options"]').count() > 0,
              "keep row expands to options")
        page.locator('[data-testid="data-row-story-keep-choose"]').click()
        page.wait_for_timeout(800)
        decided = page.locator('[data-testid="data-row-story-keep-decided"]')
        check(decided.count() > 0 and "Kept in the app" in decided.inner_text(),
              "keep row settles into quiet decided state")
        check(page.locator('[data-testid="data-row-story-keep-options"]').count() == 0,
              "options collapse after choosing")

        # Decided row re-tappable to change.
        keep_header.click()
        page.wait_for_timeout(800)
        check(page.locator('[data-testid="data-row-story-keep-options"]').count() > 0,
              "decided row re-taps open to change")
        # Re-choose to restore the decided state.
        page.locator('[data-testid="data-row-story-keep-choose"]').click()
        page.wait_for_timeout(800)

        # ---- 3. Partner-memory row ----
        partner_header = page.locator('[data-testid="data-row-partner-header"]')
        check(partner_header.count() > 0, "partner-memory row present")
        check("Shared memories with Alex" in partner_header.inner_text(),
              "partner row uses Epic 7 display name")
        check("1 shared moment" in partner_header.inner_text(),
              "partner row shows the shared-moment count")
        tap(partner_header)
        check(page.get_by_text("Pregnancy notifications to Alex have already stopped").count() > 0,
              "partner row explains notifications already stopped")
        page.locator('[data-testid="data-row-partner-keep"]').click()
        page.wait_for_timeout(800)
        pdecided = page.locator('[data-testid="data-row-partner-decided"]')
        check(pdecided.count() > 0 and "Alex keeps them" in pdecided.inner_text(),
              "partner row decided: Alex keeps them")

        # ---- 4. Delete row -> gentle guard ----
        print("Delete guard...")
        del_header = page.locator('[data-testid="data-row-story-delete-header"]')
        tap(del_header)
        tap(page.locator('[data-testid="data-row-story-delete-choose"]'))
        check(page.get_by_text("Delete everything?").count() > 0, "gentle guard appears")
        check(page.get_by_text("There’s no undo — take all the time you need.").count() > 0,
              "guard is unhurried")
        check(page.get_by_text("You can also export first, then delete.").count() > 0,
              "guard suggests exporting first")
        # Cancel path: keep my story.
        page.locator('[data-testid="delete-guard-keep"]').click()
        page.wait_for_timeout(800)
        check(page.get_by_text("It's done.").count() > 0, "guard cancel returns to It's done")
        check(page.locator('[data-testid="data-row-story-delete-decided"]').count() == 0,
              "no decision recorded on guard cancel")
        check(page.locator('[data-testid="data-row-story-delete-options"]').count() > 0,
              "guard cancel returns to the still-open row (no choice lost)")

        # ---- 5. Decide later ----
        page.locator('[data-testid="decide-later-button"]').click()
        page.wait_for_timeout(1000)
        check(page.get_by_text("It's done.").count() == 0, "\"I'll decide later\" closes the sheet")

        # ---- 6. Afterwards Home ----
        print("Afterwards Home...")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(3000)
        check(page.locator('[data-testid="afterwards-home"]').count() > 0,
              "afterwards Home renders")
        check(page.get_by_text("Your story").count() > 0, "\"Your story\" title")
        check(page.get_by_text("Gentle reads").count() > 0, "Gentle reads module visible")
        for title in ["Coping with pregnancy loss",
                      "Talking about it with people you love",
                      "When you're ready: what's next"]:
            check(page.get_by_text(title).count() > 0, f"gentle read: {title[:30]}…")
        check(page.get_by_text("Pregnancy updates are off").count() > 0, "quiet note present")
        # Two moments were saved before stopping — the timeline row shows them as memories.
        trow = page.locator('[data-testid="afterwards-timeline-row"]')
        check(trow.count() > 0 and "2 moments" in trow.inner_text(),
              "timeline row: moments kept as memories")
        # Zero developmental content.
        body_text = page.locator("body").inner_text()
        for banned in ["What's happening this week", "A little wonder", "WEEK ",
                       "Your briefing will appear here", "size of a"]:
            check(banned not in body_text, f"no developmental content: {banned!r}")

        # ---- 7. Week tab quiet state ----
        print("Week tab...")
        page.goto(f"http://localhost:{PORT}/nurture/week?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(3000)
        check(page.get_by_text("Your week view is resting").count() > 0,
              "Week tab quiet stopped state")
        check(page.get_by_text("Week 37").count() == 0, "no week number when stopped")

        # ---- 8. Delete confirm (destructive — last) ----
        print("Delete confirm...")
        page.goto(f"http://localhost:{PORT}/nurture/you?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.get_by_text("Stop pregnancy tracking").first.click()
        page.wait_for_timeout(1200)
        check(page.get_by_text("It's done.").count() > 0,
              "reopening stop row goes straight back to It's done")
        tap(page.locator('[data-testid="data-row-story-delete-header"]'))
        tap(page.locator('[data-testid="data-row-story-delete-choose"]'))
        page.locator('[data-testid="delete-guard-confirm"]').click()
        page.wait_for_timeout(1500)
        ddecided = page.locator('[data-testid="data-row-story-delete-decided"]')
        check(ddecided.count() > 0 and "Deleted" in ddecided.inner_text(),
              "delete row decided after explicit confirm")
        check(page.get_by_text("Your story has been deleted.").count() > 0,
              "plain deletion confirmation toast copy present")

        # ---- 9. Afterwards Home after deletion: timeline row hides ----
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(3000)
        check(page.locator('[data-testid="afterwards-home"]').count() > 0,
              "afterwards Home still renders after deletion")
        check(page.locator('[data-testid="afterwards-timeline-row"]').count() == 0,
              "timeline row hidden when nothing saved")

        browser.close()

    print(f"\nepic9 browser: {passed} passed, {failed} failed, {len(errors)} page errors")
    for e in errors[:5]:
        print(f"  pageerror: {e[:200]}")
    sys.exit(1 if failed or errors else 0)


if __name__ == "__main__":
    main()
