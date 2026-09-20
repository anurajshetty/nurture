#!/usr/bin/env python3
"""
Standing interactive browser test: Epic 3 timeline (3.1 list, 3.2 filters, 3.3 look-back).

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/ (same pattern as voice_browser_test.py). Events are
seeded through the app's own test hooks (?testhooks=1 ->
window.__nurtureTest.seedEvent, backed by the real SQLite store), so every
assertion below exercises the real grouping, filtering, and look-back code.

Day groups approved by Anuraj Sept 20, 2026: "Today", "Yesterday",
"Friday, Sep 18" — the week pill is a pure filter, never a divider.

Run:  python3 tests/interactive/timeline_browser_test.py [--keep-open]
Must stay green before any push that touches the timeline/composer.

Flows:
  0. week filter default -> pill reads the current week (display week);
     All weeks restores
  1. boot + seed -> timeline renders seeded events grouped in day groups
     (Today / Yesterday / older), no week-band dividers
  2. filter chips -> chip order All · Reports · Appointments · Logs;
     Reports empty state when nothing seeded,
     Appointments/Logs narrow the stream; All restores;
     empty filter shows the warm empty state
  3. look-back -> "N weeks ago today" card appears under All, hides under a
     filter, dismisses, and stays dismissed after reload
  4. week filter dropdown -> pill opens the inline dropdown listing All
     weeks + every week; picking one filters the feed to that week's
     day groups alone (never week bands) and the pill label matches
"""

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

# Card-root counter: [data-testid^="event-card-"] also matches the
# event-card-date-* / event-card-questions-* / event-card-delete-*
# sub-nodes, so filter to the UUID card roots.
CARD_COUNT_JS = """() => Array.from(
  document.querySelectorAll('[data-testid^="event-card-"]')
).filter(el => /^event-card-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  .test(el.getAttribute('data-testid'))).length"""


SCROLLER_JS = """() => {
  const list = document.querySelector('[data-testid="timeline-list"]');
  if (!list) return null;
  const cands = [list, ...list.querySelectorAll('*')];
  for (const el of cands) {
    const s = getComputedStyle(el);
    if (/auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) {
      return el;
    }
  }
  return null;
}"""


def card_count(page):
    # Scroll top->bottom so the virtualized list mounts every card,
    # then count the rendered card roots.
    page.evaluate(
        f"() => {{ const sc = ({SCROLLER_JS})(); if (sc) sc.scrollTop = 0; }}")
    page.wait_for_timeout(300)
    page.evaluate(
        f"() => {{ const sc = ({SCROLLER_JS})(); if (sc) sc.scrollTop = sc.scrollHeight; }}")
    page.wait_for_timeout(500)
    return page.evaluate(CARD_COUNT_JS)

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  // Day groups key on the LOCAL calendar day of createdAt (the story
  // date), so backdate createdAt explicitly — saveEvent stamps "now".
  const now = new Date();
  const at = (daysAgo, h) => {
    const x = new Date(now);
    x.setDate(x.getDate() - daysAgo);
    x.setHours(h === undefined ? 9 : h, 12, 0, 0);
    return x.toISOString();
  };
  const seedAt = (input, createdAt) => {
    const ev = t.seedEvent(input);
    t.setCreatedAt(ev.id, createdAt);
  };
  seedAt({ type: "note", occurredAt: at(0),
    data: { text: "Slept through the night for the first time in weeks." } }, at(0));
  seedAt({ type: "symptom", occurredAt: at(1),
    data: { symptoms: ["Heartburn", "Backache"] } }, at(1));
  seedAt({ type: "photo", occurredAt: at(3),
    data: { text: "Bump at 24 weeks",
            attachments: [{ id: "a1", kind: "photo", name: "bump.jpg",
                            upload: "pending" }] } }, at(3));
  seedAt({ type: "appointment", occurredAt: at(8),
    data: { title: "Growth scan" } }, at(8));
  // 28 days ago -> inside the 4-weeks-ago look-back window.
  seedAt({ type: "note", occurredAt: at(28),
    data: { text: "There's the heartbeat — 158 bpm." } }, at(28));
  return "seeded";
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
        # SPA fallback: expo-router tab routes (e.g. /willow/logs) have no
        # static file; serve index.html so the router resolves client-side.
        # (Same pattern as epic4_journal_test.py.)
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def main():
    failures = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))
        page.goto(BASE, timeout=30000)

        # Fresh profile boots to onboarding (Week-as-home change): complete it
        # via the test hooks, then navigate DIRECTLY to the tab route with
        # ?testhooks=1 (expo-router drops the query on in-app redirects, and
        # reload() after tab navigation loses the hooks too).
        try:
            page.wait_for_function(
                "() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)
        page.evaluate(
            "() => { const t = window.__nurtureTest; t.completeOnboarding();"
            " t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }")
        page.goto(ORIGIN + "/willow/week?testhooks=1", timeout=30000)

        home = page.get_by_test_id("week-screen")
        try:
            home.wait_for(timeout=30000)
        except Exception:
            check("app boots to week", False, "week-screen never appeared")
            print("body text:", page.evaluate("document.body.innerText.slice(0, 300)"))
            browser.close()
            sys.exit(1)
        check("app boots to Week", True)

        # Seed through the real store, then reload so the timeline reads them.
        seed_status = page.evaluate(SEED_JS)
        check("test hooks active and seeded", seed_status == "seeded", f"status={seed_status}")
        page.reload()
        home.wait_for(timeout=30000)
        # Timeline now lives on the Logs tab (new Home = briefing).
        page.get_by_role("tab", name="Logs").click()
        page.get_by_test_id("logs-screen").wait_for(timeout=10000)

        # ---- Flow 0: week filter defaults to the current display week ----
        # Regression for the reported bug (pill said Week 37, divider said
        # Week 38): the pill must read the 1-based display week. The feed
        # itself groups by day now — the pill never renders as a divider.
        pill = page.get_by_test_id("week-jump-button")
        pill_text = pill.inner_text()
        check("flow0: pill defaults to the current week", "Week 38" in pill_text,
              f"pill={pill_text!r}")
        pill.click()
        page.get_by_test_id("week-filter-dropdown").wait_for(timeout=5000)
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(600)
        check("flow0: All weeks restores the pill label",
              "All weeks" in page.get_by_test_id("week-jump-button").inner_text())

        cards = page.locator('[data-testid^="event-card-"]')
        try:
            page.wait_for_function(
                f"() => ({CARD_COUNT_JS})() >= 5",
                timeout=15000,
            )
        except Exception:
            check("flow1: 5 seeded events render", False,
                  f"only {page.evaluate(CARD_COUNT_JS)} cards rendered")
        else:
            check("flow1: 5 seeded events render", True)

        groups = page.locator('[data-testid^="day-group-"]')
        n_groups = groups.count()
        check("flow1: events grouped into 2+ day groups", n_groups >= 2,
              f"groups={n_groups}")
        check("flow1: no week-band dividers render",
              page.locator('[data-testid^="week-band-"]').count() == 0)
        group_text = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"day-group-\"]'))"
            ".map(el => el.innerText.trim()).join(' | ')").lower()
        check("flow1: day groups titled Today / Yesterday / older",
              "today" in group_text and "yesterday" in group_text,
              f"groups={group_text!r}")

        # ---- Flow 2: filter chips narrow the stream ----
        # Chip order (Anuraj Sept 2026, day-groups mockup):
        # All · Reports · Appointments · Logs.
        chip_order = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"filter-chip-\"]'))"
            ".map(el => el.getAttribute('data-testid'))")
        check("flow2: chip order is All · Reports · Appointments · Logs",
              chip_order == ["filter-chip-all", "filter-chip-reports",
                             "filter-chip-appointments", "filter-chip-logs"],
              f"chips={chip_order!r}")
        check("flow2: no Notes/Symptoms/Kicks/Photos chips",
              page.get_by_test_id("filter-chip-notes").count() == 0
              and page.get_by_test_id("filter-chip-symptoms").count() == 0
              and page.get_by_test_id("filter-chip-kicks").count() == 0
              and page.get_by_test_id("filter-chip-photos").count() == 0)

        page.get_by_test_id("filter-chip-reports").click()
        page.wait_for_timeout(600)
        n = card_count(page)
        body = page.evaluate("document.body.innerText")
        check("flow2: Reports shows no cards (none seeded)", n == 0, f"cards={n}")
        check("flow2: Reports warm empty state",
              "Nothing here yet" in body, "empty copy missing")

        page.get_by_test_id("filter-chip-appointments").click()
        page.wait_for_timeout(600)
        n = card_count(page)
        body = page.evaluate("document.body.innerText")
        check("flow2: Appointments filter shows only the appointment", n == 1, f"cards={n}")
        check("flow2: appointment card shown", "Growth scan" in body)
        check("flow2: look-back hidden while filtering",
              page.get_by_test_id("lookback-card").count() == 0)

        page.get_by_test_id("filter-chip-logs").click()
        page.wait_for_timeout(600)
        n = card_count(page)
        body = page.evaluate("document.body.innerText")
        check("flow2: Logs filter shows the 4 journal entries", n == 4, f"cards={n}")
        check("flow2: Logs excludes the appointment", "Growth scan" not in body)

        page.get_by_test_id("filter-chip-all").click()
        page.wait_for_timeout(600)
        n = card_count(page)
        check("flow2: All restores the full stream", n == 5, f"cards={n}")

        # ---- Flow 3: look-back card ----
        lb = page.get_by_test_id("lookback-card")
        try:
            lb.wait_for(timeout=8000)
        except Exception:
            check("flow3: look-back card appears under All", False, "not rendered")
        else:
            check("flow3: look-back card appears under All", True)
            txt = lb.inner_text()
            check("flow3: look-back kicker says weeks ago",
                  "weeks ago today" in txt.lower(), f"card={txt[:120]!r}")
            check("flow3: look-back surfaces the 28-day-old note",
                  "heartbeat" in txt, f"card={txt[:120]!r}")
        page.get_by_test_id("lookback-dismiss").click()
        page.wait_for_timeout(600)
        check("flow3: dismiss removes the card",
              page.get_by_test_id("lookback-card").count() == 0)
        page.reload()
        # Reload restores the Logs route (expo-router web keeps the tab in the URL).
        page.get_by_test_id("logs-screen").wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        check("flow3: dismissal persists after reload",
              page.get_by_test_id("lookback-card").count() == 0)

        # ---- Flow 4: week filter dropdown (replaces the old bottom-sheet picker) ----
        jump = page.get_by_test_id("week-jump-button")
        check("flow4: week-jump button present", jump.count() == 1)
        jump.click()
        picker = page.get_by_test_id("week-filter-dropdown")
        try:
            picker.wait_for(timeout=5000)
        except Exception:
            check("flow4: week filter dropdown opens", False)
        else:
            check("flow4: week filter dropdown opens", True)
            rows = page.locator('[data-testid^="week-filter-option-"]')
            check("flow4: dropdown lists All weeks + every week", rows.count() >= 30,
                  f"rows={rows.count()}")
            # The seed has an appointment 8 days ago -> completed week 36
            # (display "Week 37"; option testIDs carry the internal
            # completed number). Filter to it and confirm the feed shows
            # only that week's day groups — never a week-band divider.
            page.get_by_test_id("week-filter-option-36").click()
            page.wait_for_timeout(800)
            check("flow4: picking a week closes the dropdown",
                  page.get_by_test_id("week-filter-dropdown").count() == 0)
            groups = page.locator('[data-testid^="day-group-"]')
            check("flow4: filtered feed shows only that week's day groups",
                  groups.count() >= 1
                  and page.locator('[data-testid^="week-band-"]').count() == 0,
                  f"groups={groups.count()}")
            pill = page.get_by_test_id("week-jump-button").inner_text()
            check("flow4: pill label matches the filter", "Week 37" in pill,
                  f"pill={pill!r}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        sys.exit(1)
    print("ALL TIMELINE BROWSER TESTS PASSED")


if __name__ == "__main__":
    main()
