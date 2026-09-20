#!/usr/bin/env python3
"""
Interactive test: Logs day groups (Anuraj-approved mockup Sept 20, 2026).

The Logs feed groups entries by local-calendar day — "Today",
"Yesterday", older days as "Friday, Sep 18" — newest day first, newest
entry first within a day. The week pill is a pure FILTER and never
renders as a divider.

Run:  python3 tests/interactive/logs_day_groups_test.py [--keep-open]
Must stay green before any push that touches the Logs header or timeline.

Flows:
  1. boot + seed -> day-group headers render (Today / Yesterday /
     weekday-date), newest first; no week-band dividers; labels are
     muted gray (never coral)
  2. exactly four filter chips: All · Reports · Appointments · Logs
  3. midnight boundary: 11:58 PM and 12:03 AM kick sessions land in
     different day groups (device-local dates)
  4. report summary: long text clamps with coral "Show more" ->
     expands to full text and flips to "Show less"; short text shows
     no toggle
  5. appointment card tap opens the unchanged questions-only sheet
     (Anuraj-approved Sept 19, 2026 — this release does not touch it)
  6. week pill filters the feed without becoming a divider
  7. zero page errors throughout
"""

import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
LOGS = ORIGIN + "/willow/logs?testhooks=1"

KEEP_OPEN = "--keep-open" in sys.argv

# A summary long enough to overflow 4 clamped lines at 390px.
LONG_SUMMARY = (
    "Your growth scan looks typical for this stage — a routine check your "
    "care team is already watching. The measurements sit comfortably within "
    "the expected range, and the fluid levels read as normal. Nothing in "
    "this report changes the plan: keep your next visit on the calendar, "
    "and bring any new symptoms with you so the midwife can note them. "
    "This summary is general information, not a diagnosis."
)
SHORT_SUMMARY = "Your glucose screen is in the normal range."

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  // Day groups key on the LOCAL calendar day of createdAt (the story
  // date), so backdate createdAt explicitly — saveEvent stamps "now".
  const now = new Date();
  const at = (daysAgo, h, m) => {
    const x = new Date(now);
    x.setDate(x.getDate() - daysAgo);
    x.setHours(h === undefined ? 9 : h, m === undefined ? 12 : m, 0, 0);
    return x.toISOString();
  };
  const seedAt = (input, createdAt) => {
    const ev = t.seedEvent(input);
    t.setCreatedAt(ev.id, createdAt);
  };
  seedAt({ type: "note", occurredAt: at(0),
    data: { text: "Today I felt the first flutter. MAGICTODAY" } }, at(0));
  seedAt({ type: "note", occurredAt: at(1),
    data: { text: "Yesterday was calmer. MAGICYESTERDAY" } }, at(1));
  seedAt({ type: "note", occurredAt: at(2),
    data: { text: "Two days ago, long walk. MAGICOLDER" } }, at(2));
  // One older seed in the previous completed week, for the week-pill
  // filter flow below.
  seedAt({ type: "note", occurredAt: at(8),
    data: { text: "Eight days ago. MAGICWEEK36" } }, at(8));
  // Midnight boundary in the BROWSER's local timezone: 11:58 PM
  // yesterday and 12:03 AM today must land in different day groups.
  const lateISO = at(1, 23, 58);
  const earlyISO = at(0, 0, 3);
  seedAt({ type: "kick_session", occurredAt: lateISO,
    data: { kicks: 10 } }, lateISO);
  seedAt({ type: "kick_session", occurredAt: earlyISO,
    data: { kicks: 10 } }, earlyISO);
  // A future-scheduled appointment logged today: it groups by the day
  // it was LOGGED in, and its card opens the full editor.
  const future = new Date(now.getTime() + 10 * 86400000).toISOString();
  seedAt({ type: "appointment", occurredAt: future,
    data: { title: "Growth scan MAGICAPPT", withWhom: "Dr. Izu",
            notes: "Bring insurance card" } }, at(0));
  // Report summaries: one long (overflows 4 lines), one short.
  const longSummary = "__LONG__";
  const shortSummary = "__SHORT__";
  seedAt({ type: "report", occurredAt: at(0),
    data: { category: "report",
            reportSummary: { status: "ready", title: "Growth scan summary",
                             summary: longSummary,
                             attachmentName: "scan.pdf",
                             needsAttention: false } } }, at(0));
  seedAt({ type: "report", occurredAt: at(1),
    data: { category: "report",
            reportSummary: { status: "ready", title: "Glucose screen summary",
                             summary: shortSummary,
                             attachmentName: "glucose.pdf",
                             needsAttention: false } } }, at(1));
  return "seeded";
})()
""".replace("__LONG__", LONG_SUMMARY).replace("__SHORT__", SHORT_SUMMARY)

GROUP_TITLES_JS = (
    "() => Array.from(document.querySelectorAll('[data-testid^=\"day-group-\"]'))"
    ".map(g => g.innerText.trim())"
)

# Map each event card to its day-group title: the last day-group header
# that precedes the card in document order (robust to SectionList's
# nesting; no sibling-walk assumptions). Only the card roots
# (event-card-<uuid>) are mapped — not the event-card-date-* /
# event-card-questions-* / event-card-delete-* sub-nodes.
CARD_GROUP_JS = """() => {
  const headers = Array.from(document.querySelectorAll('[data-testid^="day-group-"]'));
  const map = {};
  document.querySelectorAll('[data-testid^="event-card-"]').forEach((card) => {
    const tid = card.getAttribute('data-testid');
    if (!/^event-card-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tid)) return;
    let label = null;
    for (const h of headers) {
      // 4 = DOCUMENT_POSITION_FOLLOWING: the card sits after the header.
      if (h.compareDocumentPosition(card) & 4) label = h.innerText.trim();
      else break;
    }
    map[tid] = { group: label, text: card.innerText.slice(0, 300) };
  });
  return map;
}"""

MUTED_RGB = "rgb(138, 128, 120)"  # colors.muted #8A8078

# NOTE: RN web renders Text with textTransform:uppercase as literal
# uppercase in the DOM. Compare case-insensitively.
def norm(t):
    return t.strip().lower()


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
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
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
        page.goto(LOGS, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False)
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        status = page.evaluate(SEED_JS)
        check("seeded", status == "seeded", f"status={status}")
        page.goto(LOGS, timeout=30000)
        try:
            page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        except Exception:
            check("logs screen boots", False)
            browser.close()
            sys.exit(1)
        check("logs screen boots", True)
        # The default week filter (current week) holds 3 day groups for
        # these seeds (today / yesterday / 2 days ago). Wait for all of
        # them: the SectionList virtualizes below-fold sections, so
        # reading titles after the first group appears is racy.
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid^=\"day-group-\"]').length >= 3",
            timeout=15000)

        # ---- 1. day groups, newest first; no week bands; muted labels ----
        titles = page.evaluate(GROUP_TITLES_JS)
        check("day groups render", len(titles) == 3, f"titles={titles}")
        check("first group is Today",
              len(titles) > 0 and norm(titles[0]) == "today", f"titles={titles}")
        check("second group is Yesterday",
              len(titles) > 1 and norm(titles[1]) == "yesterday", f"titles={titles}")
        older_ok = all(
            re.match(r"^\w+, \w{3} \d{1,2}$", norm(t)) for t in titles[2:])
        check("older groups read as 'Friday, Sep 18'",
              older_ok and len(titles) > 2, f"titles={titles}")
        check("no week-band dividers render",
              page.locator('[data-testid^="week-band-"]').count() == 0)
        # RN web renders Text as a nested div; the header's text child
        # carries the color.
        day_colors = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"day-group-\"]'))"
            ".map(h => { const t = h.querySelector('div');"
            " return t ? getComputedStyle(t).color : 'none'; })")
        check("day labels are the muted gray, never coral",
              len(day_colors) > 0 and all(c == MUTED_RGB for c in day_colors),
              f"colors={day_colors[:4]}")

        # ---- 2. exactly four filter chips ----
        chips = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"filter-chip-\"]'))"
            ".map(el => el.getAttribute('data-testid'))")
        check("exactly four chips: All · Reports · Appointments · Logs",
              chips == ["filter-chip-all", "filter-chip-reports",
                        "filter-chip-appointments", "filter-chip-logs"],
              f"chips={chips}")

        # ---- 3. midnight boundary: 11:58 PM vs 12:03 AM in different groups ----
        # The kick cards show relative times ("Yesterday · 11:58 PM",
        # "Today · 12:03 AM") — those strings identify the two sessions.
        card_groups = page.evaluate(CARD_GROUP_JS)
        late_group = next((v["group"] for v in card_groups.values()
                           if "11:58 PM" in v["text"]), None)
        early_group = next((v["group"] for v in card_groups.values()
                            if "12:03 AM" in v["text"]), None)
        check("11:58 PM kick in Yesterday",
              late_group is not None and norm(late_group) == "yesterday",
              f"late_group={late_group}")
        check("12:03 AM kick in Today",
              early_group is not None and norm(early_group) == "today",
              f"early_group={early_group}")

        # ---- 4. report summary Show more / Show less ----
        toggles = page.get_by_test_id("report-summary-toggle")
        check("long summary shows the Show more toggle", toggles.count() == 1,
              f"toggles={toggles.count()}")
        check("short summary shows no toggle",
              page.locator('[data-testid="report-summary-card"]')
                  .filter(has_text="Glucose screen summary")
                  .get_by_test_id("report-summary-toggle").count() == 0)
        toggle = toggles.first
        check("toggle reads Show more", toggle.inner_text().strip() == "Show more")
        toggle_color = toggle.evaluate(
            "el => { const t = el.querySelector('div');"
            " return t ? getComputedStyle(t).color : 'none'; }")
        check("toggle is coral", toggle_color == "rgb(200, 95, 62)",
              f"color={toggle_color}")
        toggle.click()
        page.wait_for_timeout(400)
        check("tap expands to Show less",
              toggles.first.inner_text().strip() == "Show less")
        long_card = page.locator('[data-testid="report-summary-card"]') \
            .filter(has_text="Growth scan summary").first
        check("expanded shows the full long summary",
              LONG_SUMMARY in long_card.inner_text())
        toggles.first.click()
        page.wait_for_timeout(400)
        check("tap collapses back to Show more",
              toggles.first.inner_text().strip() == "Show more")

        # ---- 5. appointment card opens the unchanged questions sheet ----
        # The shipped editor is the mockup-17 questions-only sheet
        # (Anuraj-approved Sept 19, 2026; old full editor retired).
        # This release does not touch it.
        appt_card = page.locator('[data-testid^="event-card-"]') \
            .filter(has_text="MAGICAPPT").first
        appt_card.click()
        try:
            page.get_by_test_id("appointment-editor").wait_for(timeout=8000)
            check("appointment tap opens the editor", True)
        except Exception:
            check("appointment tap opens the editor", False)
        body = page.evaluate("document.body.innerText")
        body_lower = body.lower()
        for word in ["your questions", "jot down what you want to ask", "save"]:
            check(f"editor still shows '{word}'", word in body_lower, f"word={word}")
        check("appointment grouped by the day it was logged (Today)",
              any(norm(v["group"] or "") == "today" and "MAGICAPPT" in v["text"]
                  for v in card_groups.values()))
        # Close the sheet so it doesn't cover the pill checks below.
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ---- 6. week pill is a pure filter ----
        pill = page.get_by_test_id("week-jump-button")
        check("pill defaults to the current display week", "Week 38" in pill.inner_text(),
              f"pill={pill.inner_text()!r}")
        pill.click()
        page.get_by_test_id("week-filter-dropdown").wait_for(timeout=5000)
        # Completed week 36 (display "Week 37"): the seeds from 1-2 days
        # ago live there. Option testIDs carry the internal completed
        # number; labels show the display week.
        page.get_by_test_id("week-filter-option-36").click()
        page.wait_for_timeout(700)
        titles = page.evaluate(GROUP_TITLES_JS)
        check("filtered feed shows only that week's day groups",
              len(titles) == 1 and all(norm(t) != "today" for t in titles),
              f"titles={titles}")
        check("pill label matches the filter", "Week 37" in pill.inner_text(),
              f"pill={pill.inner_text()!r}")
        check("no week-band divider under a week filter",
              page.locator('[data-testid^="week-band-"]').count() == 0)
        page.get_by_test_id("week-jump-button").click()
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(700)
        check("All weeks restores the full story",
              norm(page.evaluate(GROUP_TITLES_JS)[0]) == "today")

        # ---- 7. zero page errors ----
        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}")

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
    print("ALL DAY-GROUP TESTS PASSED")


if __name__ == "__main__":
    main()
