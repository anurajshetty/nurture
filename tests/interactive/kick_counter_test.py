#!/usr/bin/env python3
"""
Kick counter interactive test (Willow, Anuraj approved Sept 20, 2026) —
the week-19 gate, floating kicks pill, Home card, counting screen
(tap / pause / resume / end / auto-summary / strength / save / discard /
exit), history screen ("Her pattern", session rows, reminder opt-in),
Logs feed card (deviation-only save link, attach, confirmation), and the
appointment sheet KICKS section — against the real web export at 390x844
served under /willow/ (with ?testhooks=1).

Locked behaviors under test:
  (a) week gate: at displayed week 18, no kicks pill, no Home card, no
      trace; at week 19 both appear (pill stacked 12pt above the ask
      pill, same right edge).
  (b) pill opens the counting screen (full-screen, always-visible x);
      card opens "Her pattern" (NOT the counter).
  (c) counting: giant tap zone counts; elapsed timer counts up; pause
      freezes the clock; resume restarts it; end early is allowed with no
      scolding; the summary opens automatically at 10 movements; strength
      is optional; save persists a kick_session event; discard saves
      nothing; the x exits with "Session ended — nothing was saved."
  (d) Home card retires permanently after the first saved session; the
      pill stays.
  (e) history: gentle pattern line (no grades/streaks/verdicts), session
      rows, reminder starts OFF; only "Yes, remind me" enables it —
      "Not now" and sheet dismissal leave it off; one-tap pause turns it
      off again; the choice persists.
  (f) feed card: time + "N movements in X minutes" + strength note; the
      gentle flag + care line + "Save to my next appointment" appear ONLY
      on sessions that deviate from her usual pattern; ordinary sessions
      show no link.
  (g) save link: attaches ONLY to the immediate next future appointment
      (never skips a full one); max 5 per appointment hides the link;
      already-attached hides the link; no future appointment hides it;
      tap shows "Added to your <date> appointment with Dr. Izu" ~2s,
      then the link disappears.
  (h) appointment sheet: KICKS section renders only with >= 1 attached
      session (rows: date, count, duration, strength; x removes with a
      44pt target); with zero attached the sheet is unchanged.
  (i) zero page errors throughout.

Run: python3 tests/interactive/kick_counter_test.py
"""

import datetime
import http.server
import os
import threading

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
PORT = 8915
ORIGIN = f"http://127.0.0.1:{PORT}"
WEEK = ORIGIN + "/willow/week?testhooks=1"
LOGS = ORIGIN + "/willow/logs?testhooks=1"

TODAY = datetime.date.today()
# Displayed week = completed weeks + 1. Completed 18 -> displayed 19.
DUE_19 = (TODAY + datetime.timedelta(days=154)).isoformat()
DUE_18 = (TODAY + datetime.timedelta(days=161)).isoformat()

FLAG = "This one felt different from your usual \u2014 worth mentioning at your visit."
CARE_FEED = "If movements feel less than usual, call your care team \u2014 don\u2019t wait on it."
CARE_COUNTING = "Quieter than usual? Contact your provider \u2014 they\u2019d rather hear from you."
EXIT_TOAST = "Session ended \u2014 nothing was saved."
PATTERN_FALLBACK = "A couple more sessions and we\u2019ll start seeing her pattern."


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]
        query = self.path[len(path):]
        if path.startswith("/willow/"):
            rel = path[len("/willow/"):]
            if not rel or not os.path.isfile(os.path.join(DIST, rel)):
                rel = "index.html"
            self.path = "/" + rel + query
        return super().do_GET()

    def log_message(self, *args):
        pass


def seed_common(page, due):
    """Complete onboarding + seed a pregnancy; retry until the hooks answer."""
    for _ in range(30):
        try:
            page.evaluate(
                """(due) => {
                    window.__nurtureTest.completeOnboarding();
                    window.__nurtureTest.seedPregnancy({ dueDate: due, parity: 'first' });
                }""",
                due,
            )
            return
        except Exception:
            page.wait_for_timeout(2000)
    raise SystemExit("seeding never succeeded")


def run():
    from playwright.sync_api import sync_playwright

    passed, failed = 0, 0
    errors: list = []

    def check(cond, name):
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f"  ok: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
            ),
        )

        def new_page():
            ctx = browser.new_context(viewport={"width": 390, "height": 844})
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(WEEK, wait_until="domcontentloaded")
            page.wait_for_function(
                "() => typeof window.__nurtureTest !== 'undefined'",
                timeout=30000,
            )
            return ctx, page

        # ---------------- Context A: week gate ----------------
        print("Context A: week-18 hidden, week-19 visible")
        ctx, page = new_page()
        seed_common(page, DUE_18)
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.wait_for_timeout(600)
        check(page.get_by_test_id("kicks-fab").count() == 0, "A1: no kicks pill at week 18")
        check(page.get_by_test_id("week-kick-card").count() == 0, "A2: no Home card at week 18")
        check(page.get_by_test_id("ask-fab").count() == 1, "A3: ask pill still there at week 18")
        ctx.close()

        ctx, page = new_page()
        seed_common(page, DUE_19)
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.wait_for_timeout(600)
        fab = page.get_by_test_id("kicks-fab")
        check(fab.count() == 1, "A4: kicks pill visible at week 19")
        check(page.get_by_test_id("week-kick-card").count() == 1, "A5: Home card visible at week 19")
        # Pill stacking: kicks sits above ask, same right edge, 12pt gap.
        kb = fab.bounding_box()
        ab = page.get_by_test_id("ask-fab").bounding_box()
        check(kb is not None and ab is not None, "A6: both pills have boxes")
        if kb and ab:
            check(abs((kb["x"] + kb["width"]) - (ab["x"] + ab["width"])) < 2,
                  "A7: same right edge as ask pill")
            check(kb["y"] + kb["height"] <= ab["y"] + 1,
                  "A8: kicks pill stacked above ask pill")
        # Card opens the history list, NOT the counter.
        page.get_by_test_id("week-kick-card").click()
        page.get_by_test_id("kick-history-screen").wait_for(timeout=5000)
        check(page.get_by_test_id("kick-counting-screen").count() == 0,
              "A9: card opens history, not the counter")
        check(PATTERN_FALLBACK in page.get_by_test_id("kick-pattern-card").inner_text(),
              "A10: empty pattern fallback line")
        page.get_by_test_id("kick-history-back").click()
        page.wait_for_timeout(400)
        check(page.get_by_test_id("kick-history-screen").count() == 0,
              "A11: history back closes the screen")

        # ---------------- Context A2: reminder opt-in ----------------
        print("Context A2: reminder opt-in only")
        page.get_by_test_id("week-kick-card").click()
        page.get_by_test_id("kick-history-screen").wait_for(timeout=5000)
        toggle = page.get_by_test_id("kick-reminder-toggle")
        def reminder_on():
            return page.evaluate("() => window.__nurtureTest.isKickReminderOn()")
        check(reminder_on() is False,
              "B1: reminder starts OFF")
        toggle.click()
        page.get_by_test_id("kick-reminder-sheet").wait_for(timeout=5000)
        check("A quiet evening nudge?" in page.get_by_test_id("kick-reminder-sheet").inner_text(),
              "B2: opt-in sheet asks first")
        page.get_by_test_id("kick-reminder-notnow").click()
        page.wait_for_timeout(600)
        check(page.get_by_test_id("kick-reminder-sheet").count() == 0,
              "B3: Not now dismisses the sheet")
        check(reminder_on() is False,
              "B4: Not now leaves it OFF")
        # Scrim dismissal also leaves it off.
        toggle.click()
        page.get_by_test_id("kick-reminder-sheet").wait_for(timeout=5000)
        page.mouse.click(195, 120)  # scrim, above the sheet
        page.wait_for_timeout(800)
        check(reminder_on() is False,
              "B5: scrim dismissal leaves it OFF")
        # Yes enables it, and the choice persists across reboot.
        toggle.click()
        page.get_by_test_id("kick-reminder-sheet").wait_for(timeout=5000)
        page.get_by_test_id("kick-reminder-yes").click()
        page.wait_for_timeout(600)
        check(reminder_on() is True,
              "B6: Yes, remind me turns it ON")
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.get_by_test_id("week-kick-card").click()
        page.get_by_test_id("kick-history-screen").wait_for(timeout=5000)
        check(reminder_on() is True,
              "B7: reminder choice persists")
        # One-tap pause.
        page.get_by_test_id("kick-reminder-toggle").click()
        page.wait_for_timeout(400)
        check(reminder_on() is False,
              "B8: one tap pauses it again")
        check(CARE_COUNTING in page.get_by_test_id("kick-history-screen").inner_text(),
              "B9: care line on history screen")
        ctx.close()

        # ---------------- Context C: counting flow ----------------
        print("Context C: counting screen")
        ctx, page = new_page()
        seed_common(page, DUE_19)
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.wait_for_timeout(500)
        page.get_by_test_id("kicks-fab").click()
        page.get_by_test_id("kick-counting-screen").wait_for(timeout=5000)
        check(page.get_by_test_id("kick-exit").count() == 1, "C1: always-visible exit")
        check(CARE_COUNTING in page.get_by_test_id("kick-counting-screen").inner_text(),
              "C2: exact care line on counting screen")
        tapzone = page.get_by_test_id("kick-tapzone")
        for _ in range(3):
            tapzone.click()
        check(page.get_by_test_id("kick-count").inner_text() == "3", "C3: tap zone counts")
        elapsed = page.get_by_test_id("kick-elapsed").inner_text()
        import re
        check(re.match(r"^\d+:\d\d elapsed$", elapsed) is not None,
              f"C4: elapsed timer counts up ({elapsed})")
        page.get_by_test_id("kick-pause").click()
        page.get_by_test_id("kick-paused").wait_for(timeout=5000)
        check("the clock is stopped" in page.get_by_test_id("kick-paused").inner_text(),
              "C5: pause overlay")
        page.get_by_test_id("kick-resume").click()
        page.wait_for_timeout(400)
        check(page.get_by_test_id("kick-paused").count() == 0, "C6: resume restarts")
        # End early with taps -> summary, no scolding.
        page.get_by_test_id("kick-end").click()
        page.get_by_test_id("kick-summary").wait_for(timeout=5000)
        summary_text = page.get_by_test_id("kick-summary").inner_text()
        check("3 movements in" in summary_text, "C7: end early opens summary")
        check("incomplete" not in summary_text.lower(), "C8: no scolding on early end")
        page.get_by_test_id("kick-strength-strong").click()
        page.get_by_test_id("kick-save").click()
        page.wait_for_timeout(800)
        check(page.get_by_test_id("kick-counting-screen").count() == 0,
              "C9: save closes the counter")
        check(page.evaluate("() => window.__nurtureTest.countEventsOfType('kick_session')") == 1,
              "C9b: save persists exactly one session")
        check(page.get_by_test_id("week-kick-card").count() == 0,
              "C10: Home card retires after first saved session")
        check(page.get_by_test_id("kicks-fab").count() == 1,
              "C11: pill stays after the card retires")
        # Discard saves nothing.
        page.get_by_test_id("kicks-fab").click()
        page.get_by_test_id("kick-counting-screen").wait_for(timeout=5000)
        page.get_by_test_id("kick-tapzone").click()
        page.get_by_test_id("kick-end").click()
        page.get_by_test_id("kick-summary").wait_for(timeout=5000)
        page.get_by_test_id("kick-discard").click()
        page.wait_for_timeout(500)
        check(page.get_by_test_id("kick-counting-screen").count() == 0,
              "C12: discard closes without saving")
        check(page.evaluate("() => window.__nurtureTest.countEventsOfType('kick_session')") == 1,
              "C12b: discard saved nothing")
        # Exit x -> toast, nothing saved.
        page.get_by_test_id("kicks-fab").click()
        page.get_by_test_id("kick-counting-screen").wait_for(timeout=5000)
        page.get_by_test_id("kick-tapzone").click()
        page.get_by_test_id("kick-exit").click()
        toast = page.get_by_test_id("kick-toast")
        toast.wait_for(timeout=5000)
        check(EXIT_TOAST in toast.inner_text(), "C13: exit toast copy")
        page.wait_for_timeout(2400)
        check(page.get_by_test_id("kick-counting-screen").count() == 0,
              "C14: exit closes after the toast")
        check(page.evaluate("() => window.__nurtureTest.countEventsOfType('kick_session')") == 1,
              "C14b: exit saved nothing")
        # Auto-summary at 10.
        page.get_by_test_id("kicks-fab").click()
        page.get_by_test_id("kick-counting-screen").wait_for(timeout=5000)
        tz = page.get_by_test_id("kick-tapzone")
        for _ in range(10):
            tz.click()
        page.get_by_test_id("kick-summary").wait_for(timeout=5000)
        check("10 movements in" in page.get_by_test_id("kick-summary").inner_text(),
              "C15: auto-summary at 10 movements")
        page.get_by_test_id("kick-save").click()
        page.wait_for_timeout(600)
        ctx.close()

        # ---------------- Context D: history rows + feed cards ----------------
        print("Context D: history rows, feed cards, save link")
        ctx, page = new_page()
        seed_common(page, DUE_19)
        ids = page.evaluate(
            """() => {
                const T = window.__nurtureTest;
                const day = 86400000;
                const now = Date.now();
                const iso = (ms) => new Date(ms).toISOString();
                const s = (id, movements, durationSec, strength, ms) =>
                  T.seedEvent({ type: 'kick_session', occurredAt: iso(ms),
                    data: { movements, durationSec, durationMin: Math.round(durationSec/60),
                      ...(strength ? { strength } : {}) } }).id;
                const out = {};
                // Her usual: ~15-20 min, strong.
                out.p1 = s('p1', 10, 900, 'strong', now - 3*day);
                out.p2 = s('p2', 10, 1080, 'strong', now - 2*day);
                out.p3 = s('p3', 10, 1200, 'usual', now - 1*day);
                // Deviating: 40 minutes (>> 1.5x her ~17.7-min average).
                out.dev = s('dev', 10, 2400, 'strong', now - 3600000);
                // Ordinary: right on her average.
                out.ord = s('ord', 10, 1050, 'strong', now - 1800000);
                // Weaker: fluttery against a strong usual.
                out.weak = s('weak', 6, 1000, 'fluttery', now - 900000);
                // Immediate next appointment (Oct-ish), then a later one.
                out.appt1 = T.seedEvent({ type: 'appointment',
                  occurredAt: iso(now + 12*day),
                  data: { title: 'Appointment with Dr. Izu' } }).id;
                out.appt2 = T.seedEvent({ type: 'appointment',
                  occurredAt: iso(now + 40*day),
                  data: { title: 'Growth scan' } }).id;
                return out;
            }"""
        )
        # History rows via the card (seeded after render, before refocus —
        # the card doesn't re-check until tab focus).
        page.goto(WEEK, wait_until="domcontentloaded")
        page.get_by_test_id("week-screen").wait_for(timeout=15000)
        page.wait_for_timeout(500)
        check(page.get_by_test_id("week-kick-card").count() == 0,
              "D1: card retired once sessions exist")
        page.goto(LOGS, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)

        def feed_card(eid):
            card = page.get_by_test_id(f"kick-feed-{eid}")
            card.scroll_into_view_if_needed()
            return card

        dev = feed_card(ids["dev"])
        dev_text = dev.inner_text()
        check("10 movements in 40 minutes" in dev_text, "D2: deviating session line")
        check("Mostly strong." in dev_text, "D3: strength note")
        check(FLAG in dev_text, "D4: gentle flag on deviation")
        check(CARE_FEED in dev_text, "D5: calm care guidance")
        link = page.get_by_test_id(f"kick-save-appt-{ids['dev']}")
        check(link.count() == 1, "D6: save link on deviating session")

        weak = feed_card(ids["weak"])
        check(FLAG in weak.inner_text(), "D7: weaker session also flagged")
        check(page.get_by_test_id(f"kick-save-appt-{ids['weak']}").count() == 1,
              "D8: weaker session gets the link too")

        ordc = feed_card(ids["ord"])
        ord_text = ordc.inner_text()
        check("10 movements in" in ord_text, "D9: ordinary session renders")
        check(FLAG not in ord_text, "D10: no flag on ordinary session")
        check(page.get_by_test_id(f"kick-save-appt-{ids['ord']}").count() == 0,
              "D11: no save link on ordinary session")

        # Tap the save link -> confirmation -> link disappears.
        link.click()
        conf = page.get_by_test_id(f"kick-confirm-{ids['dev']}")
        conf.wait_for(timeout=5000)
        conf_text = conf.inner_text()
        check(conf_text.startswith("Added to your ") and
              "appointment with Dr. Izu" in conf_text,
              f"D12: confirmation copy ({conf_text})")
        page.wait_for_timeout(2500)
        check(page.get_by_test_id(f"kick-save-appt-{ids['dev']}").count() == 0,
              "D13: link disappears after confirmation")
        # Already attached -> stays hidden after reboot.
        page.goto(LOGS, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        feed_card(ids["dev"])
        check(page.get_by_test_id(f"kick-save-appt-{ids['dev']}").count() == 0,
              "D14: attached session never re-offers the link")

        # The appointment sheet shows the KICKS section with the row.
        appt_card = page.get_by_test_id(f"event-card-{ids['appt1']}")
        appt_card.scroll_into_view_if_needed()
        appt_card.click()
        page.get_by_test_id("appointment-editor").wait_for(timeout=8000)
        kicks_section = page.get_by_test_id("appointment-kicks")
        check(kicks_section.count() == 1, "D15: KICKS section appears")
        sec_text = kicks_section.inner_text()
        check("KICKS" in sec_text and "10 kicks" in sec_text and "40 min" in sec_text,
              f"D16: kick row content ({sec_text!r})")
        check("strong" in sec_text, "D17: strength on the row")
        # Remove the session -> section hides (sheet back to mockup 17).
        page.get_by_test_id(f"kick-remove-{ids['dev']}").click()
        page.wait_for_timeout(600)
        check(page.get_by_test_id("appointment-kicks").count() == 0,
              "D18: removing the last session hides KICKS")
        check(page.get_by_test_id("question-add").count() == 1,
              "D19: questions section unchanged")
        page.get_by_test_id("appointment-save").click()
        page.wait_for_timeout(600)
        ctx.close()

        # ---------------- Context E: full next appointment hides link ------
        print("Context E: five-session cap + empty sheet")
        ctx, page = new_page()
        seed_common(page, DUE_19)
        e_ids = page.evaluate(
            """() => {
                const T = window.__nurtureTest;
                const day = 86400000;
                const now = Date.now();
                const iso = (ms) => new Date(ms).toISOString();
                const s = (movements, durationSec, strength, ms) =>
                  T.seedEvent({ type: 'kick_session', occurredAt: iso(ms),
                    data: { movements, durationSec,
                      durationMin: Math.round(durationSec/60), strength } }).id;
                s(10, 900, 'strong', now - 3*day);
                s(10, 1080, 'strong', now - 2*day);
                const dev = s(10, 2400, 'strong', now - 3600000);
                // Immediate next is FULL (5 attached) — the link must hide
                // and never skip to the later appointment.
                const kicks = [0,1,2,3,4].map((i) => ({
                  id: 'seed-k' + i, movements: 10, durationSec: 900,
                  occurredAt: iso(now - 5*day), strength: 'strong' }));
                T.seedEvent({ type: 'appointment',
                  occurredAt: iso(now + 12*day),
                  data: { title: 'Appointment with Dr. Izu',
                    kickSessions: kicks } });
                T.seedEvent({ type: 'appointment',
                  occurredAt: iso(now + 40*day),
                  data: { title: 'Growth scan' } });
                const empty = T.seedEvent({ type: 'appointment',
                  occurredAt: iso(now + 60*day),
                  data: { title: 'Checkup' } }).id;
                return { dev, empty };
            }"""
        )
        page.goto(LOGS, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        dev_id = e_ids["dev"]
        card = page.get_by_test_id(f"kick-feed-{dev_id}")
        card.scroll_into_view_if_needed()
        check(FLAG in card.inner_text(), "E1: deviating session flagged")
        check(page.get_by_test_id(f"kick-save-appt-{dev_id}").count() == 0,
              "E2: full next appointment hides the link (no skipping)")
        # Empty appointment -> sheet has no KICKS section.
        empty_id = e_ids["empty"]
        apc = page.get_by_test_id(f"event-card-{empty_id}")
        apc.scroll_into_view_if_needed()
        apc.click()
        page.get_by_test_id("appointment-editor").wait_for(timeout=8000)
        check(page.get_by_test_id("appointment-kicks").count() == 0,
              "E3: no KICKS section when nothing attached")
        check(page.get_by_test_id("question-add").count() == 1,
              "E4: questions UI unchanged with zero kicks")
        ctx.close()

    print(f"\ninteractive: {passed} passed, {failed} failed; page errors: {len(errors)}")
    for e in errors[:10]:
        print("  pageerror:", e[:200])
    if errors:
        failed += 1
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    run()
