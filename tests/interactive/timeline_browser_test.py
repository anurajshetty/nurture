#!/usr/bin/env python3
"""
Standing interactive browser test: Epic 3 timeline (3.1 list, 3.2 filters, 3.3 look-back).

Drives the REAL Nurture web UI in real Chromium against the built dist/
served under /nurture/ (same pattern as voice_browser_test.py). Events are
seeded through the app's own test hooks (?testhooks=1 ->
window.__nurtureTest.seedEvent, backed by the real SQLite store), so every
assertion below exercises the real grouping, filtering, and look-back code.

Run:  python3 tests/interactive/timeline_browser_test.py [--keep-open]
Must stay green before any push that touches the timeline/composer.

Flows:
  1. boot + seed -> timeline renders seeded events grouped in week bands
  2. filter chips -> Photos/Symptoms/Kicks narrow the stream; All restores;
     empty filter shows the warm empty state
  3. look-back -> "N weeks ago today" card appears under All, hides under a
     filter, dismisses, and stays dismissed after reload
  4. week picker -> jump button opens the sheet; picking a week closes it
"""

import mimetypes
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/app-ideas/pregnancy-tracker/nurture-app")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/nurture/?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  // Pregnancy with a due date -> pregnancy-week bands + week-jump button.
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  t.seedEvent({ type: "note", occurredAt: iso(0),
    data: { text: "Slept through the night for the first time in weeks." } });
  t.seedEvent({ type: "symptom", occurredAt: iso(1),
    data: { symptoms: ["Heartburn", "Backache"] } });
  t.seedEvent({ type: "photo", occurredAt: iso(3),
    data: { text: "Bump at 24 weeks",
            attachments: [{ id: "a1", kind: "photo", name: "bump.jpg",
                            upload: "pending" }] } });
  t.seedEvent({ type: "appointment", occurredAt: iso(8),
    data: { title: "Growth scan" } });
  // 28 days ago -> inside the 4-weeks-ago look-back window.
  t.seedEvent({ type: "note", occurredAt: iso(28),
    data: { text: "There's the heartbeat — 158 bpm." } });
  return "seeded";
})()
"""


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/nurture/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/nurture/"):]
    if "?" in rel:
        rel = rel.split("?", 1)[0]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        return route.fulfill(status=404, body="not found: " + rel)
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

        home = page.get_by_test_id("home-screen")
        try:
            home.wait_for(timeout=30000)
        except Exception:
            check("app boots to home timeline", False, "home-screen never appeared")
            print("body text:", page.evaluate("document.body.innerText.slice(0, 300)"))
            browser.close()
            sys.exit(1)
        check("app boots to home timeline", True)

        # Seed through the real store, then reload so the timeline reads them.
        seed_status = page.evaluate(SEED_JS)
        check("test hooks active and seeded", seed_status == "seeded", f"status={seed_status}")
        page.reload()
        home.wait_for(timeout=30000)
        cards = page.locator('[data-testid^="event-card-"]')
        try:
            page.wait_for_function(
                '() => document.querySelectorAll(\'[data-testid^="event-card-"]\').length >= 5',
                timeout=15000,
            )
        except Exception:
            check("flow1: 5 seeded events render", False,
                  f"only {cards.count()} cards rendered")
        else:
            check("flow1: 5 seeded events render", True)

        bands = page.locator('[data-testid^="week-band-"]')
        n_bands = bands.count()
        check("flow1: events grouped into 2+ week bands", n_bands >= 2,
              f"bands={n_bands}")
        band_text = page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-testid^=\"week-band-\"]'))"
            ".map(el => el.innerText).join(' | ')")
        check("flow1: pregnancy week bands titled", "Week 37" in band_text,
              f"bands={band_text!r}")

        # ---- Flow 2: filter chips narrow the stream ----
        page.get_by_test_id("filter-chip-photos").click()
        page.wait_for_timeout(600)
        n = page.locator('[data-testid^="event-card-"]').count()
        check("flow2: Photos filter shows only the photo event", n == 1, f"cards={n}")
        check("flow2: look-back hidden while filtering",
              page.get_by_test_id("lookback-card").count() == 0)

        page.get_by_test_id("filter-chip-symptoms").click()
        page.wait_for_timeout(600)
        n = page.locator('[data-testid^="event-card-"]').count()
        check("flow2: Symptoms filter shows only the symptom event", n == 1, f"cards={n}")

        page.get_by_test_id("filter-chip-kicks").click()
        page.wait_for_timeout(600)
        n = page.locator('[data-testid^="event-card-"]').count()
        body = page.evaluate("document.body.innerText")
        check("flow2: Kicks filter shows no cards", n == 0, f"cards={n}")
        check("flow2: warm empty state on empty filter",
              "Nothing here yet" in body, "empty copy missing")

        page.get_by_test_id("filter-chip-all").click()
        page.wait_for_timeout(600)
        n = page.locator('[data-testid^="event-card-"]').count()
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
        home.wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        check("flow3: dismissal persists after reload",
              page.get_by_test_id("lookback-card").count() == 0)

        # ---- Flow 4: week picker ----
        jump = page.get_by_test_id("week-jump-button")
        check("flow4: week-jump button present", jump.count() == 1)
        jump.click()
        picker = page.get_by_test_id("week-picker")
        try:
            picker.wait_for(timeout=5000)
        except Exception:
            check("flow4: week picker opens", False)
        else:
            check("flow4: week picker opens", True)
            rows = page.locator('[data-testid^="week-row-"]')
            check("flow4: picker lists weeks", rows.count() >= 30,
                  f"rows={rows.count()}")
            rows.first.click()
            page.wait_for_timeout(800)
            check("flow4: picking a week closes the picker",
                  page.get_by_test_id("week-picker").count() == 0)

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
