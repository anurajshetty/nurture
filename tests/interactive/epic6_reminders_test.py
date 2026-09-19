#!/usr/bin/env python3
"""
Standing interactive browser test: Epic 6 reminders.

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/ (same pattern as timeline_browser_test.py). An
appointment is seeded through the app's own test hooks (?testhooks=1 ->
window.__nurtureTest.seedEvent, backed by the real SQLite store), then:

 1. boot with zero page errors
 2. Plan deep link ?appointment=<id> renders the appointment detail
    (landed banner, when/where, question inbox, reminder row)
 3. question chips cycle through all five states: To ask -> Asked ✓ ->
    Answered -> Deferred -> Dismissed -> To ask
 4. question states persist across navigation (real SQLite)
 5. "+ Add a question" adds a To ask question and persists it
 6. reminder row navigates to You -> Notifications
 7. back button returns to the Plan tiles (Journal tile intact)
 8. unknown appointment id shows the gentle missing state
 9. the shipped scheduling / snooze / neutral-copy / nudge logic runs in
    the real browser JS engine (compiled TS evaluated in-page):
    - planAppointmentReminders decisions (incl. quiet-hours handling)
    - describeReminderResponse actions (snooze 10/60, pause, dismiss, view)
    - neutral lock-screen copy never leaks note/symptom/mood text
    - decideNudge still fires at most once a day, only when nothing logged

Run:  python3 tests/interactive/epic6_reminders_test.py [--keep-open]
Must stay green before any push that touches notifications/plan.
"""

import json
import mimetypes
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv
CHROME = "/opt/meta-chromium/chrome"
if not os.path.exists(CHROME):
    CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")

SEED_JS = r"""(() => {
  const t = window.__nurtureTest;
  if (!t) return JSON.stringify({ status: "no-hooks" });
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 30, 0, 0);
  const ev = t.seedEvent({
    type: "appointment",
    occurredAt: d.toISOString(),
    data: {
      title: "Appointment",
      provider: "Dr. Izu",
      place: "Providence Holy Cross",
      questions: [
        { id: "q1", text: "Can we go over the birth plan together?", state: "to_ask" },
        { id: "q2", text: "Which prenatal class do you recommend?", state: "asked" },
        { id: "q3", text: "Is daily walking still fine at this stage?", state: "answered" },
      ],
    },
  });
  return JSON.stringify({ status: "seeded", id: ev.id });
})()"""

# Compiled pure modules (tsc output) loaded into the page with a tiny
# require shim so the SHIPPED logic runs in the real browser engine.
PURE_DIR = "/tmp/nurture-epic6-tests"
PURE_FILES = {
    "types": "src/lib/types.js",
    "nudgeLogic": "src/notifications/nudgeLogic.js",
    "reminderCopy": "src/notifications/reminderCopy.js",
    "appointments": "src/notifications/appointments.js",
    "snooze": "src/notifications/snooze.js",
    "questions": "src/plan/questions.js",
}
PURE_PATHMAP = {
    "./nudgeLogic": "nudgeLogic",
    "./reminderCopy": "reminderCopy",
    "./appointments": "appointments",
    "./questions": "questions",
    "../lib/types": "types",
}

BROWSER_LOGIC_JS = r"""() => {
  const mods = window.__epic6mods.exports;
  const out = {};
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const t = (name, cond) => { out[name] = !!cond; };

  // --- appointment scheduling decisions (in real V8) ---
  const { planAppointmentReminders, adjustForQuietHours } = mods.appointments;
  const now = Date.now();
  const at = (h, m, off) => { const d = new Date(now + off * 864e5); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const base = (over) => Object.assign({
    appointments: [], leadMinutes: 60, remindersEnabled: true, paused: false,
    pregnancyActive: true, permissionGranted: true,
    quietStart: "21:00", quietEnd: "08:00", nowMs: now,
  }, over);

  let plans = planAppointmentReminders(base({
    appointments: [{ id: "a1", occurredAt: at(10, 30, 1), data: {} }],
  }));
  t("sched: fires at lead time", plans.length === 1 &&
    plans[0].fireAtMs === new Date(at(9, 30, 1)).getTime());

  plans = planAppointmentReminders(base({ pregnancyActive: false,
    appointments: [{ id: "a1", occurredAt: at(10, 30, 1), data: {} }] }));
  t("sched: nothing when pregnancy stopped", plans.length === 0);

  plans = planAppointmentReminders(base({ paused: true,
    appointments: [{ id: "a1", occurredAt: at(10, 30, 1), data: {} }] }));
  t("sched: nothing when paused", plans.length === 0);

  // Evening visit, lead lands in quiet hours -> just before quiet hours.
  plans = planAppointmentReminders(base({
    appointments: [{ id: "eve", occurredAt: at(22, 0, 1), data: {} }],
  }));
  t("sched: quiet hours honored (8:59 PM)", plans.length === 1 &&
    plans[0].fireAtMs === new Date(at(20, 59, 1)).getTime());

  t("sched: adjustForQuietHours exported sane",
    adjustForQuietHours(new Date(at(22, 30, 0)).getTime(), new Date(at(10, 0, 1)).getTime(),
      "21:00", "08:00", now) === new Date(at(8, 0, 1)).getTime());

  // --- snooze actions ---
  const { describeReminderResponse, snoozeFireAtMs } = mods.snooze;
  const d = { kind: "appointment", appointmentId: "a1" };
  t("snooze: +10 action", eq(describeReminderResponse("snooze_10", d),
    { kind: "snooze", appointmentId: "a1", minutes: 10 }));
  t("snooze: +60 action", eq(describeReminderResponse("snooze_60", d),
    { kind: "snooze", appointmentId: "a1", minutes: 60 }));
  t("snooze: pause action", eq(describeReminderResponse("pause_all", d), { kind: "pause" }));
  t("snooze: dismiss action", eq(describeReminderResponse("dismiss", d),
    { kind: "dismiss", appointmentId: "a1" }));
  t("snooze: body tap deep-links", eq(
    describeReminderResponse("expo.modules.notifications.actions.DEFAULT", d),
    { kind: "view", appointmentId: "a1" }));
  t("snooze: foreign notification ignored",
    eq(describeReminderResponse("snooze_10", { kind: "end-of-day" }), { kind: "ignore" }));
  t("snooze: fire time math", snoozeFireAtMs(1_000_000, 10) === 1_600_000);

  // --- neutral lock-screen copy (in real V8) ---
  const { appointmentReminderCopy } = mods.reminderCopy;
  const copy = appointmentReminderCopy(at(10, 30, 1), {
    note: "nauseous all morning, spotting again, feeling anxious",
    symptoms: ["nausea"], mood: "anxious", provider: "Dr. Izu", place: "Providence Holy Cross",
  }, now);
  const leaks = ["nauseous", "spotting", "anxious", "nausea"].some((w) => copy.body.includes(w));
  t("copy: no health details leak", !leaks);
  t("copy: provider + questions line kept",
    copy.body.includes("Dr. Izu") && copy.body.includes("Your questions are ready for the visit."));

  // --- question states ---
  const { nextQuestionState, readQuestionsFromData } = mods.questions;
  t("questions: full 5-state cycle",
    eq(["to_ask", "asked", "answered", "deferred", "dismissed"].map(nextQuestionState),
       ["asked", "answered", "deferred", "dismissed", "to_ask"]));
  t("questions: malformed entries tolerated",
    readQuestionsFromData({ questions: [null, { id: "q", text: "ok?", state: "to_ask" }] }).length === 1);

  // --- end-of-day nudge still once-daily (untouched module) ---
  const { decideNudge } = mods.nudgeLogic;
  const nIn = (over) => Object.assign({ enabled: true, paused: false, hasEntryToday: false,
    time: "20:30", quietStart: "21:00", quietEnd: "08:00", permissionGranted: true }, over);
  t("nudge: fires when nothing logged", !!decideNudge(nIn({})));
  t("nudge: silent after a log", decideNudge(nIn({ hasEntryToday: true })) === null);
  t("nudge: silent when disabled", decideNudge(nIn({ enabled: false })) === null);
  t("nudge: silent when paused", decideNudge(nIn({ paused: true })) === null);

  return out;
}"""


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
        # SPA fallback: expo-router tab routes have no static file.
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def load_pure_modules(page):
    """Evaluate the compiled pure TS modules in-page with a require shim."""
    files = {}
    for name, rel in PURE_FILES.items():
        with open(os.path.join(PURE_DIR, rel), "r") as f:
            files[name] = f.read()
    page.evaluate(
        """(payload) => {
          const mods = {};
          const req = (id) => {
            const key = payload.pathmap[id];
            if (!key || !mods[key]) throw new Error("unmapped require: " + id);
            return mods[key].exports;
          };
          for (const [name, code] of Object.entries(payload.files)) {
            const module = { exports: {} };
            new Function("require", "module", "exports", code)(req, module, module.exports);
            mods[name] = module;
          }
          window.__epic6mods = { exports: Object.fromEntries(
            Object.entries(mods).map(([k, m]) => [k, m.exports])) };
        }""",
        {"files": files, "pathmap": PURE_PATHMAP},
    )


def main():
    failures = []
    page_errors = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
        page.on("console", lambda m: page_errors.append("console.error: " + m.text[:300])
                if m.type == "error" else None)

        # ---- Flow 1: boot ----
        # Fresh profile boots to onboarding (Week-as-home change): run the
        # seed first (it completes onboarding), then the week tab renders.
        page.goto(BASE, timeout=60000)
        try:
            page.wait_for_function(
                "() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("flow1: test hooks installed", False)
            browser.close()
            sys.exit(1)
        seed = json.loads(page.evaluate(SEED_JS))
        check("flow1: hooks seeded an appointment", seed.get("status") == "seeded", str(seed))
        page.goto(ORIGIN + "/willow/week?testhooks=1", timeout=60000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=45000)
        except Exception:
            check("flow1: app boots", False, "week-screen never appeared")
            print("body:", page.evaluate("document.body.innerText.slice(0, 300)"))
            browser.close()
            sys.exit(1)
        check("flow1: app boots to Week", True)
        appt_id = seed.get("id")
        detail_url = f"{ORIGIN}/willow/plan?appointment={appt_id}&testhooks=1"

        # ---- Flow 2: appointment detail deep link ----
        page.goto(detail_url, timeout=60000)
        try:
            page.get_by_test_id("appointment-detail").wait_for(timeout=30000)
        except Exception:
            check("flow2: appointment detail renders", False, "appointment-detail never appeared")
            print("body:", page.evaluate("document.body.innerText.slice(0, 400)"))
            browser.close()
            sys.exit(1)
        check("flow2: appointment detail renders", True)
        body = page.evaluate("document.body.innerText")
        check("flow2: landed banner", "landed here from the reminder" in body)
        check("flow2: provider + place shown", "Dr. Izu" in body and "Providence Holy Cross" in body)
        check("flow2: three seeded questions", page.locator('[data-testid^="question-row-"]').count() == 3)
        chips = {
            qid: page.get_by_test_id(f"question-chip-{qid}").inner_text()
            for qid in ("q1", "q2", "q3")
        }
        check("flow2: seeded states", chips == {"q1": "TO ASK", "q2": "ASKED ✓", "q3": "ANSWERED"},
              str(chips))
        check("flow2: reminder row shows lead time", "1 hour before" in body)

        # ---- Flow 3: cycle all five states ----
        expected = ["ASKED ✓", "ANSWERED", "DEFERRED", "DISMISSED", "TO ASK"]
        ok = True
        for want in expected:
            page.get_by_test_id("question-row-q1").click()
            page.wait_for_timeout(400)
            got = page.get_by_test_id("question-chip-q1").inner_text()
            if got != want:
                ok = False
                check("flow3: chip cycle", False, f"wanted {want!r}, got {got!r}")
                break
        if ok:
            check("flow3: chip cycles all five states", True)

        # ---- Flow 4: states persist ----
        page.get_by_test_id("question-row-q2").click()  # Asked ✓ -> Answered
        page.wait_for_timeout(400)
        page.get_by_test_id("question-row-q2").click()  # Answered -> Deferred
        page.wait_for_timeout(400)
        check("flow4: q2 now Deferred",
              page.get_by_test_id("question-chip-q2").inner_text() == "DEFERRED")
        page.goto(detail_url, timeout=60000)
        page.get_by_test_id("appointment-detail").wait_for(timeout=30000)
        page.wait_for_timeout(800)
        check("flow4: q1 cycle persisted",
              page.get_by_test_id("question-chip-q1").inner_text() == "TO ASK")
        check("flow4: q2 Deferred persisted",
              page.get_by_test_id("question-chip-q2").inner_text() == "DEFERRED")

        # ---- Flow 5: add a question ----
        page.get_by_test_id("question-add").click()
        page.get_by_test_id("question-input").fill("What should I pack for the visit?")
        page.get_by_test_id("question-save").click()
        page.wait_for_timeout(600)
        check("flow5: new question row appears",
              page.locator('[data-testid^="question-row-"]').count() == 4)
        new_chip = page.evaluate(
            """() => { const els = document.querySelectorAll('[data-testid^="question-chip-"]');
               return els[els.length - 1].innerText; }""")
        check("flow5: new question starts To ask", new_chip == "TO ASK", repr(new_chip))
        page.goto(detail_url, timeout=60000)
        page.get_by_test_id("appointment-detail").wait_for(timeout=30000)
        page.wait_for_timeout(800)
        check("flow5: added question persists",
              page.locator('[data-testid^="question-row-"]').count() == 4)

        # ---- Flow 6: reminder row -> You tab ----
        page.get_by_test_id("appointment-reminder-row").click()
        try:
            page.wait_for_url("**/you**", timeout=10000)
        except Exception:
            check("flow6: reminder row opens You tab", False, page.url)
        else:
            check("flow6: reminder row opens You tab", True)
            check("flow6: Notifications section present",
                  "Notifications" in page.evaluate("document.body.innerText"))

        # ---- Flow 7: back to Plan tiles ----
        page.goto(detail_url, timeout=60000)
        page.get_by_test_id("appointment-detail").wait_for(timeout=30000)
        page.get_by_test_id("appointment-back").click()
        page.wait_for_timeout(800)
        check("flow7: back returns to Plan tiles",
              page.get_by_test_id("plan-tile-journal").count() == 1)
        check("flow7: detail closed",
              page.get_by_test_id("appointment-detail").count() == 0)

        # ---- Flow 8: unknown id -> gentle missing state ----
        page.goto(f"{ORIGIN}/willow/plan?appointment=does-not-exist&testhooks=1", timeout=60000)
        page.wait_for_timeout(1500)
        check("flow8: missing appointment is gentle",
              "isn’t here anymore" in page.evaluate("document.body.innerText"))

        # ---- Flow 9: shipped logic in the real browser engine ----
        load_pure_modules(page)
        results = page.evaluate(BROWSER_LOGIC_JS)
        for name, cond in results.items():
            check("flow9: " + name, cond)

        # ---- Flow 10: zero page errors ----
        real_errors = [e for e in page_errors if "favicon" not in e.lower()]
        check("flow10: zero page errors", len(real_errors) == 0,
              "; ".join(real_errors[:3]))

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURES")
        sys.exit(1)
    print("\nAll Epic 6 browser checks passed")


if __name__ == "__main__":
    main()
