#!/usr/bin/env python3
"""
Regression test: Logs day-group headers must not overlap moment cards.

Anuraj caught this on the live app (Sept 19, 2026): the sticky section
header (then "Week N" — now the day-group labels "Today", "Yesterday",
"Friday, Sep 18") rendered on top of a moment card, with card text
bleeding through above/below the header band.

Root cause: the header used marginTop/marginBottom for its spacing.
Backgrounds don't cover margins, so when the header sticks
(stickySectionHeadersEnabled), cards scrolling underneath show through the
transparent margin zones. Fix: full-bleed opaque background via padding
(zero vertical margins) + zIndex so the stuck header paints above cards.

Run:  python3 tests/interactive/logs_daygroup_overlap_test.py [--keep-open]
Must stay green before any push that touches the timeline.

Flows:
  1. boot + seed -> 3+ day groups render with tall multi-line cards
  2. mechanism: every day-group header has zero vertical margins and an
     opaque background (no transparent zones for cards to show through)
  3. visual: scroll a tall card under a stuck header at 390x844 and
     screenshot it for human review (screenshots in /tmp)
"""

import mimetypes
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

LONG = (
    "I'm doing OK I just finished my work I'm very tired but I'm doing OK so far. "
    "I was feeling a little moody earlier in the day but then it became better and "
    "now I'm feeling much more like myself again, just taking it slow."
)

SEED_JS_TEMPLATE = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  const LONGTEXT = __LONGTEXT__;
  // Day groups key on the LOCAL calendar day of createdAt (the story
  // date), so backdate createdAt explicitly — saveEvent stamps "now".
  const now = new Date();
  const at = (daysAgo, h) => {
    const x = new Date(now);
    x.setDate(x.getDate() - daysAgo);
    x.setHours(h === undefined ? 9 : h, 12, 0, 0);
    return x.toISOString();
  };
  const days = [0, 0, 1, 2, 4, 6, 8, 9, 11, 13, 15, 17, 20, 24, 27];
  days.forEach((d, i) => {
    const created = at(d, i % 5);
    const ev = t.seedEvent({ type: "note", occurredAt: created,
      data: { text: "Moment " + (i + 1) + " (" + d + "d ago). " + LONGTEXT } });
    t.setCreatedAt(ev.id, created);
  });
  const hb = at(28, 3);
  const ev28 = t.seedEvent({ type: "note", occurredAt: hb,
    data: { text: "There's the heartbeat - 158 bpm." } });
  t.setCreatedAt(ev28.id, hb);
  return "seeded";
})()
"""

SEED_JS = SEED_JS_TEMPLATE.replace("__LONGTEXT__", json.dumps(LONG))


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


SCROLL_SETUP_JS = """
(() => {
  const band = document.querySelectorAll('[data-testid^="day-group-"]')[1];
  if (!band) return "no-band";
  let el = band.parentElement, scroller = null;
  while (el) {
    const s = getComputedStyle(el);
    if (/auto|scroll/.test(s.overflowY)) { scroller = el; break; }
    el = el.parentElement;
  }
  if (!scroller) return "no-scroller";
  window.__scroller = scroller;
  window.__band = band;
  return "ok";
})()
"""

# Margin/bleed mechanism check: sticky headers must have zero vertical
# margins (backgrounds don't cover margins) and an opaque background.
MECHANISM_JS = """
(() => {
  const out = [];
  document.querySelectorAll('[data-testid^="day-group-"]').forEach((b) => {
    const s = getComputedStyle(b);
    out.push({
      id: b.getAttribute("data-testid"),
      marginTop: s.marginTop,
      marginBottom: s.marginBottom,
      backgroundColor: s.backgroundColor,
      zIndex: s.zIndex,
      position: s.position,
    });
  });
  return out;
})()
"""


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

        # Fresh profile boots to onboarding (Week-as-home change). Complete it
        # and seed a pregnancy via the test hooks, then navigate DIRECTLY to
        # the tab routes with ?testhooks=1 (expo-router drops the query on
        # in-app redirects, and reload() after tab navigation loses it too).
        try:
            page.wait_for_function(
                "() => window.__nurtureTest !== undefined",
                timeout=30000,
            )
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        page.evaluate(
            "() => { const t = window.__nurtureTest; "
            "t.completeOnboarding(); "
            "t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }"
        )
        page.goto(ORIGIN + "/willow/week?testhooks=1", timeout=30000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
        except Exception:
            check("app boots to week", False, "week-screen never appeared")
            print("body text:", page.evaluate("document.body.innerText.slice(0, 300)"))
            browser.close()
            sys.exit(1)
        check("app boots to Week", True)

        seed_status = page.evaluate(SEED_JS)
        check("events seeded", seed_status == "seeded", f"status={seed_status}")
        page.goto(ORIGIN + "/willow/logs?testhooks=1", timeout=30000)
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        # The week pill is a filter defaulting to the current week (Anuraj
        # Sept 2026) — show all weeks so every seeded band renders.
        page.get_by_test_id("week-jump-button").click()
        page.get_by_test_id("week-filter-dropdown").wait_for(timeout=5000)
        page.get_by_test_id("week-filter-option-all").click()
        page.wait_for_timeout(600)
        try:
            page.wait_for_function(
                '() => document.querySelectorAll(\'[data-testid^="event-card-"]\').length >= 10',
                timeout=20000,
            )
        except Exception:
            check("flow1: 10+ seeded cards render", False)
        else:
            check("flow1: 10+ seeded cards render", True)

        n_groups = page.locator('[data-testid^="day-group-"]').count()
        check("flow1: 3+ day groups render", n_groups >= 3, f"groups={n_groups}")

        # ---- Flow 2: the bleed mechanism must be gone ----
        bands = page.evaluate(MECHANISM_JS)
        for b in bands:
            check(f"flow2: {b['id']} has zero vertical margins",
                  b["marginTop"] == "0px" and b["marginBottom"] == "0px",
                  f"marginTop={b['marginTop']} marginBottom={b['marginBottom']}")
            bg = b["backgroundColor"]
            check(f"flow2: {b['id']} background is opaque",
                  bg.startswith("rgb(") and "rgba" not in bg.replace(" ", ""),
                  f"backgroundColor={bg}")

        # ---- Flow 3: visual — slide a tall card under a stuck header ----
        setup = page.evaluate(SCROLL_SETUP_JS)
        check("flow3: found band + inner scroller", setup == "ok", f"setup={setup}")
        if setup == "ok":
            # Natural (unstuck) position first.
            page.evaluate("window.__band.scrollIntoView({block: 'start'})")
            page.wait_for_timeout(700)
            page.screenshot(path="/tmp/logs-overlap-natural.png")
            # Now push a tall card up behind the stuck header: the header
            # sticks at the scroller top while the previous card slides under.
            page.evaluate("window.__scroller.scrollBy(0, 160)")
            page.wait_for_timeout(700)
            page.screenshot(path="/tmp/logs-overlap-stuck.png")
            # Deeper: card well behind the header.
            page.evaluate("window.__scroller.scrollBy(0, 260)")
            page.wait_for_timeout(700)
            page.screenshot(path="/tmp/logs-overlap-stuck2.png")
            check("flow3: screenshots captured", True)
            print("screenshots: /tmp/logs-overlap-natural.png /tmp/logs-overlap-stuck.png /tmp/logs-overlap-stuck2.png")

        print("page errors: see PAGEERROR lines above (none = clean)")
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
    print("\nALL GREEN")


if __name__ == "__main__":
    main()
