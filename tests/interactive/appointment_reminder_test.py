#!/usr/bin/env python3
"""
Interactive test: appointment reminder timing editor (Anuraj-approved
mockup 14, Sept 2026).

Tapping the Reminder row on an appointment opens the timing editor sheet
directly — no more detour to You -> Notifications. Presets apply with one
tap (radio fills, row updates, toast confirms, sheet settles away);
"Choose your own..." expands a stepper + typeable number (1-99) with an
Hours/Days toggle, a live preview, and a Set reminder button.

Flows (all real UI, no stubs, at 390x844):
  1. Seed an appointment -> open its detail -> Reminder row shows the
     current timing ("2 days before" default) with no "You -> Notifications"
     sub-caption; the row's accessibility label announces the timing.
  2. Tap the row -> the editor sheet opens with the visit named in the
     context line, five presets + "Choose your own...", quiet-hours foot.
  3. Tap the "3 hours before" preset -> radio fills, toast confirms
     "Reminder set - 3 hours before", sheet settles away, row reads
     "3 hours before".
  4. Reopen -> "Choose your own..." -> custom section expands; step the
     number to 12, flip to Hours -> live preview reads
     "We'll remind you 12 hours before."; Set reminder -> toast + row
     update to "12 hours before".
  5. Reopen -> the sheet re-seeds from the stored value (custom selected,
     12 Hours); type 99+clamp check via stepper at max.
  6. Zero page errors throughout.

Run:  python3 tests/interactive/appointment_reminder_test.py [--keep-open]
Must stay green before any push that touches the Plan appointment detail
or the reminder timing editor.
"""
import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
PLAN = ORIGIN + "/willow/plan?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

# Seeds one appointment 3 days out at 10:30 local; returns its event id.
SEED_JS = """
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(10, 30, 0, 0);
  const ev = t.seedEvent({
    type: "appointment",
    occurredAt: d.toISOString(),
    data: { title: "Growth scan", provider: "Dr. Izu", place: "Providence Holy Cross" },
  });
  return ev && ev.id ? ev.id : "no-id";
})()
"""


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if "?" in rel:
        rel = rel.split("?", 1)[0]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def main():
    failures = []
    page_errors = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(PLAN, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False)
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        appt_id = page.evaluate(SEED_JS)
        check("appointment seeded", appt_id not in ("no-hooks", "no-id"), f"id={appt_id}")

        # Open the appointment detail via its deep link.
        page.goto(f"{ORIGIN}/willow/plan?appointment={appt_id}&testhooks=1", timeout=30000)
        try:
            page.get_by_test_id("appointment-detail").wait_for(timeout=15000)
        except Exception:
            check("appointment detail opens", False)
            browser.close()
            sys.exit(1)
        check("appointment detail opens", True)

        def row_label():
            return page.get_by_test_id("appointment-reminder-row").inner_text()

        # ---- 1. row shows the current timing, no You detour ----
        label = row_label()
        check("row shows default timing", "2 days before" in label, f"label={label!r}")
        check("no You -> Notifications sub-caption",
              "You → Notifications" not in label and "You -&gt;" not in label, f"label={label!r}")
        aria = page.get_by_test_id("appointment-reminder-row").get_attribute("aria-label") or ""
        check("row announces timing", "Reminder, 2 days before" in aria, f"aria={aria!r}")

        # ---- 2. sheet opens with visit context + presets ----
        page.get_by_test_id("appointment-reminder-row").click()
        try:
            page.get_by_test_id("reminder-sheet").wait_for(timeout=5000)
        except Exception:
            check("editor sheet opens", False)
            browser.close()
            sys.exit(1)
        check("editor sheet opens", True)
        sheet_text = page.get_by_test_id("reminder-sheet").inner_text()
        check("sheet names the visit", "Growth scan" in sheet_text, f"sheet={sheet_text[:80]!r}")
        for minutes, text in [(60, "1 hour before"), (180, "3 hours before"),
                              (1440, "1 day before"), (2880, "2 days before"),
                              (10080, "1 week before")]:
            check(f"preset {text} present",
                  page.get_by_test_id(f"reminder-preset-{minutes}").count() == 1)
        check("custom option present",
              page.get_by_test_id("reminder-custom-option").count() == 1)
        check("quiet hours foot", "Quiet hours" in sheet_text)

        # ---- 3. preset applies on tap ----
        page.get_by_test_id("reminder-preset-180").click()
        page.wait_for_timeout(300)
        sel = page.get_by_test_id("reminder-preset-180").get_attribute("aria-checked")
        check("preset radio fills", sel == "true", f"aria-checked={sel}")
        try:
            page.get_by_test_id("appointment-toast").wait_for(timeout=5000)
        except Exception:
            check("toast confirms", False)
        else:
            toast = page.get_by_test_id("appointment-toast").inner_text()
            check("toast confirms", "Reminder set — 3 hours before" in toast, f"toast={toast!r}")
        # Sheet settles away after the tap (~650ms).
        page.wait_for_timeout(1200)
        check("sheet settles away",
              page.get_by_test_id("reminder-sheet").count() == 0)
        label = row_label()
        check("row updates to preset", "3 hours before" in label, f"label={label!r}")

        # ---- 4. custom: stepper + unit toggle + live preview + set ----
        page.get_by_test_id("appointment-reminder-row").click()
        page.get_by_test_id("reminder-sheet").wait_for(timeout=5000)
        page.get_by_test_id("reminder-custom-option").click()
        page.wait_for_timeout(400)
        check("custom section expands",
              page.get_by_test_id("reminder-custom-section").count() == 1)
        # Step up to 12 (from the seeded 3 hours -> {3, hour}).
        for _ in range(9):
            page.get_by_test_id("reminder-step-up").click()
        page.wait_for_timeout(200)
        # Flip to Hours explicitly via the toggle's Hours radio (scoped:
        # "3 hours before" also contains "hours").
        page.get_by_test_id("reminder-unit-toggle").get_by_role("radio", name="Hours").click()
        page.wait_for_timeout(200)
        preview = page.get_by_test_id("reminder-preview").inner_text()
        check("live preview", "We’ll remind you 12 hours before." in preview, f"preview={preview!r}")
        page.get_by_test_id("reminder-set-custom").click()
        page.wait_for_timeout(400)
        try:
            page.get_by_test_id("appointment-toast").wait_for(timeout=5000)
            toast = page.get_by_test_id("appointment-toast").inner_text()
        except Exception:
            toast = ""
        check("custom toast confirms", "Reminder set — 12 hours before" in toast, f"toast={toast!r}")
        page.wait_for_timeout(1200)
        check("sheet settles away after custom",
              page.get_by_test_id("reminder-sheet").count() == 0)
        label = row_label()
        check("row updates to custom", "12 hours before" in label, f"label={label!r}")

        # ---- 5. reopen re-seeds from the stored value; stepper clamps ----
        page.get_by_test_id("appointment-reminder-row").click()
        page.get_by_test_id("reminder-sheet").wait_for(timeout=5000)
        check("custom stays selected",
              (page.get_by_test_id("reminder-custom-option").get_attribute("aria-checked") or "") == "true")
        check("custom section open on reseed",
              page.get_by_test_id("reminder-custom-section").count() == 1)
        preview = page.get_by_test_id("reminder-preview").inner_text()
        check("reseeded preview", "12 hours before" in preview, f"preview={preview!r}")
        # Type 999 -> clamps to 99 on blur.
        page.get_by_test_id("reminder-custom-input").fill("999")
        page.get_by_test_id("reminder-step-up").click()
        page.wait_for_timeout(200)
        preview = page.get_by_test_id("reminder-preview").inner_text()
        check("stepper clamps at 99", "99 hours before" in preview, f"preview={preview!r}")
        page.keyboard.press("Escape")

        # ---- 6. zero page errors ----
        check("zero page errors", len(page_errors) == 0, f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    import time
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        sys.exit(1)
    print("ALL REMINDER-TIMING TESTS PASSED")


if __name__ == "__main__":
    main()
