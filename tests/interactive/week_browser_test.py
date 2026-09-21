#!/usr/bin/env python3
"""
Epic 5 browser test: Week tab in real Chromium against the production
web export served under /willow/ (with ?testhooks=1).

Verifies:
  1. Week tab renders: size hero, highlights, readings, questions, footer
  2. Week navigation: chevrons page weeks, clamped to current (never ahead)
  3. Reading accordion: tap expands in place
  4. Add question: saves a question event
  5. Stopped state: no developmental content when pregnancy stopped
  6. Zero page errors throughout

Run: python3 tests/interactive/week_browser_test.py
"""

import http.server
import socketserver
import threading
import os
import sys
import time

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
PORT = 8907
BASE = f"http://localhost:{PORT}/willow/?testhooks=1"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        # Strip the /nurture subpath; SPA fallback to index.html
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

        print("Loading app...")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(3000)
        # The bundle grew (size art); wait for the test hooks, not just the load.
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)

        # Seed a pregnancy (due 2026-10-08 → week 37 on 2026-09-19)
        page.evaluate("""() => {
            window.__nurtureTest.completeOnboarding();
            window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
        }""")
        page.wait_for_timeout(1000)

        # Navigate to Week tab
        print("Navigating to Week tab...")
        page.goto(f"http://localhost:{PORT}/willow/week?testhooks=1", wait_until="networkidle")
        page.wait_for_timeout(3000)

        # 1. Week screen renders
        check(page.locator('[data-testid="week-screen"]').count() > 0,
              "week screen renders")

        # Size hero
        check(page.locator('[data-testid="week-size-hero"]').count() > 0,
              "size hero present")
        size_name = page.locator('[data-testid="week-size-name"]')
        check(size_name.count() > 0, "size name present")
        if size_name.count() > 0:
            print(f"    size: {size_name.inner_text()}")

        # Highlights
        check(page.locator('[data-testid="week-highlights"]').count() > 0,
              "highlights card present")

        # Readings
        check(page.locator('[data-testid="week-reading-body"]').count() > 0,
              "reading rows present")

        # Questions
        check(page.locator('[data-testid="week-questions"]').count() > 0,
              "questions card present")

        # Footer: not medical advice, content updated (NOT reviewed)
        footer = page.locator('[data-testid="week-footer"]')
        check(footer.count() > 0, "footer present")
        if footer.count() > 0:
            ft = footer.inner_text()
            check("not medical advice" in ft.lower(), "footer has not-medical-advice")
            check("content updated" in ft.lower(), "footer says content updated")
            check("reviewed" not in ft.lower(), "footer does NOT claim reviewed")

        # Pill dock regression guard, round 3 (Anuraj caught it on his
        # iPhone, Sept 20, 2026 — AFTER the round-2 color fix shipped,
        # incognito, fresh load): every color was correct and every
        # check passed, yet the "solid band" was still visible. Root
        # cause was GEOMETRY, not color: the dock was an IN-FLOW
        # 160/96pt sibling below the Screen, so the scroll viewport
        # ended mid-page — on short viewports a white card hard-clipped
        # at the Screen's bottom edge (a straight seam) above the
        # static cream zone. That straight edge + static zone reads as
        # a "solid band" even when every pixel is exactly right. Tall
        # desktop viewports never showed it.
        # Corrected rule (structural): the pill zone is an ABSOLUTE
        # overlay with zero in-flow footprint (position absolute, no
        # height), the 160/96pt reserve lives INSIDE the scroll content
        # as paddingBottom, the dock stays transparent, and the screen
        # root stays page cream.
        dock = page.locator('[data-testid="week-pill-dock"]')
        check(dock.count() > 0, "pill dock present")
        if dock.count() > 0:
            dock_pos = dock.evaluate("el => getComputedStyle(el).position")
            check(dock_pos == "absolute",
                  f"pill dock is an absolute overlay, not an in-flow sibling (got {dock_pos})")
            dock_rect_h = dock.evaluate("el => el.getBoundingClientRect().height")
            check(dock_rect_h < 2,
                  f"pill dock has zero in-flow footprint (rect height {dock_rect_h:.0f}px)")
            dock_bg = dock.evaluate("el => getComputedStyle(el).backgroundColor")
            check(dock_bg in ("rgba(0, 0, 0, 0)", "transparent"),
                  f"pill dock background transparent (got {dock_bg})")
            # The pills themselves still render in the pill zone.
            check(page.locator('[data-testid="ask-fab"]').count() > 0,
                  "ask pill present")
            check(page.locator('[data-testid="kicks-fab"]').count() > 0,
                  "kicks pill present")
        # The screen root behind the transparent pill zone must be the
        # page cream — not the web tab slot's light gray, not white.
        root = page.locator('[data-testid="week-root"]')
        check(root.count() > 0, "week screen root present")
        if root.count() > 0:
            root_bg = root.evaluate("el => getComputedStyle(el).backgroundColor")
            check(root_bg == "rgb(250, 246, 240)",
                  f"pill zone renders page cream (got {root_bg})")

        # Round-3 short-viewport check (667pt iPhone height): this is the
        # test that would have caught rounds 1-3. The scroll viewport
        # must reach the tab bar (no mid-page clip boundary), the
        # reserve must be inside the scroll content, and at max scroll
        # the resting state must be seamless cream with the footer fully
        # visible and the pills floating bottom-right.
        print("Testing pill dock at 667pt viewport height...")
        page.set_viewport_size({"width": 390, "height": 667})
        page.goto(f"http://localhost:{PORT}/willow/week?testhooks=1",
                  wait_until="networkidle")
        page.wait_for_timeout(2500)
        check(page.locator('[data-testid="week-screen"]').count() > 0,
              "667pt: week screen renders")
        geo = page.evaluate("""() => {
            const root = document.querySelector('[data-testid="week-screen"]');
            let sc = null;
            (function walk(el) {
                if (el.scrollHeight > el.clientHeight + 8 &&
                    (!sc || el.scrollHeight > sc.scrollHeight)) sc = el;
                for (const k of el.children) walk(k);
            })(root);
            const content = sc ? sc.firstElementChild : null;
            const dock = document.querySelector('[data-testid="week-pill-dock"]');
            const ask = document.querySelector('[data-testid="ask-fab"]');
            const kicks = document.querySelector('[data-testid="kicks-fab"]');
            const footer = document.querySelector('[data-testid="week-footer"]');
            const r = el => { const b = el.getBoundingClientRect();
                return {top: b.top, bottom: b.bottom, left: b.left,
                        right: b.right, width: b.width, height: b.height}; };
            return {
                vpH: window.innerHeight,
                scroller: sc ? r(sc) : null,
                contentPadBottom: content ? getComputedStyle(content).paddingBottom : null,
                dockPos: dock ? getComputedStyle(dock).position : null,
                dockRect: dock ? r(dock) : null,
                askRect: ask ? r(ask) : null,
                kicksRect: kicks ? r(kicks) : null,
                footerRect: footer ? r(footer) : null,
                kicksShown: !!kicks,
            };
        }""")
        print(f"    667pt geometry: {geo}")
        if geo["scroller"]:
            gap = geo["vpH"] - geo["scroller"]["bottom"]
            check(gap <= 100,
                  f"667pt: scroll viewport reaches the tab bar (gap {gap:.0f}px)")
            # The reserve lives INSIDE the scroll content as paddingBottom.
            pad = float((geo["contentPadBottom"] or "0px").replace("px", ""))
            expect_pad = 160 if geo["kicksShown"] else 96
            check(pad >= expect_pad,
                  f"667pt: scroll content reserves {expect_pad}pt below content (got {pad:.0f}px)")
        if geo["dockRect"]:
            check(geo["dockPos"] == "absolute", "667pt: pill dock is absolute overlay")
            check(geo["dockRect"]["height"] < 2,
                  "667pt: pill dock has zero in-flow footprint")
        # Pills persistently visible bottom-right.
        for name, key in (("ask", "askRect"), ("kicks", "kicksRect")):
            rct = geo[key]
            if rct:
                check(rct["bottom"] <= geo["vpH"] and rct["right"] <= 390
                      and rct["bottom"] > geo["vpH"] - 220 and rct["left"] > 200,
                      f"667pt: {name} pill visible bottom-right")
        # Scroll to bottom: footer fully visible, resting state seamless.
        page.evaluate("""() => {
            const root = document.querySelector('[data-testid="week-screen"]');
            let sc = null;
            (function walk(el) {
                if (el.scrollHeight > el.clientHeight + 8 &&
                    (!sc || el.scrollHeight > sc.scrollHeight)) sc = el;
                for (const k of el.children) walk(k);
            })(root);
            if (sc) sc.scrollTop = sc.scrollHeight;
        }""")
        page.wait_for_timeout(1000)
        rest = page.evaluate("""() => {
            const root = document.querySelector('[data-testid="week-screen"]');
            let sc = null;
            (function walk(el) {
                if (el.scrollHeight > el.clientHeight + 8 &&
                    (!sc || el.scrollHeight > sc.scrollHeight)) sc = el;
                for (const k of el.children) walk(k);
            })(root);
            const sr = sc.getBoundingClientRect();
            const fr = document.querySelector('[data-testid="week-footer"]').getBoundingClientRect();
            const pills = [];
            for (const t of ['ask-fab', 'kicks-fab']) {
                const el = document.querySelector(`[data-testid="${t}"]`);
                if (el) { const b = el.getBoundingClientRect();
                    pills.push([b.left - 2, b.top - 2, b.right + 2, b.bottom + 2]); }
            }
            return { scBottom: sr.bottom, footerBottom: fr.bottom, pills };
        }""")
        check(rest["footerBottom"] <= rest["scBottom"] + 2,
              "667pt: footer fully visible at max scroll (content ends naturally)")
        # The resting zone between the last content and the tab bar —
        # where the pills float — must be seamless cream: no white card
        # hard-cut, no gray, no seam. (PIL pixel check.) The region starts
        # below the footer (footer text/divider are legitimate content)
        # and stops at the tab bar; the pill exclusion halo is 24px
        # because the FABs cast a soft drop shadow (shadowRadius 12 +
        # offset 4) that darkens nearby cream — the shadow is the
        # approved floating look, not a defect.
        from PIL import Image
        import io as _io
        sc_bottom = int(rest["scBottom"])
        clip_y = int(rest["footerBottom"]) + 6
        clip_h = sc_bottom - 6 - clip_y
        check(clip_h > 100,
              f"667pt: resting cream zone exists below content ({clip_h}px)")
        shot = page.screenshot(clip={"x": 0, "y": clip_y,
                                     "width": 390, "height": clip_h})
        im = Image.open(_io.BytesIO(shot)).convert("RGB")
        px = im.load()
        halo = 24
        pills_halo = [(l - halo, t - halo, r + halo, b + halo)
                      for (l, t, r, b) in rest["pills"]]
        def in_pill(x, y):
            yy = y + clip_y
            return any(l <= x <= r and t <= yy <= b
                       for (l, t, r, b) in pills_halo)
        bad = []
        for y in range(0, clip_h, 3):
            for x in range(0, 390, 3):
                if in_pill(x, y):
                    continue
                r_, g_, b_ = px[x, y]
                if not (abs(r_ - 250) <= 14 and abs(g_ - 246) <= 14
                        and abs(b_ - 240) <= 14):
                    bad.append((x, y, r_, g_, b_))
        check(len(bad) == 0,
              f"667pt: pill-zone background is seamless cream "
              f"({len(bad)} off-cream pixels"
              + (f", e.g. {bad[0]}" if bad else "") + ")")
        page.screenshot(path="/tmp/week-dock-r3-667.png")
        print("  screenshot: /tmp/week-dock-r3-667.png")
        page.set_viewport_size({"width": 390, "height": 844})

        # 2. Week navigation (date-relative: the current displayed week
        # depends on today, so read it from the page instead of
        # hardcoding — the hardcoded "Week 37" broke on Sept 20, 2026
        # when the current week rolled to 38).
        print("Testing week navigation...")
        prev_btn = page.locator('[data-testid="week-prev"]')
        next_btn = page.locator('[data-testid="week-next"]')
        check(prev_btn.count() > 0 and next_btn.count() > 0, "nav chevrons present")
        import re as _re
        _hdr = page.locator('[data-testid="week-screen"]').inner_text()
        _m = _re.search(r"Week (\d+)", _hdr)
        _cur = int(_m.group(1)) if _m else None
        check(_cur is not None, "current week readable from header")

        # Go to previous week
        prev_btn.click()
        page.wait_for_timeout(1500)
        check(_cur is not None and page.get_by_text(f"Week {_cur - 1}").count() > 0,
              f"paged to week {_cur - 1}" if _cur else "paged to previous week")
        # Back-to-current pill appears
        check(page.locator('[data-testid="week-back-current"]').count() > 0,
              "back-to-current pill appears")

        # Next returns to the current week, then the pill hides
        next_btn.click()
        page.wait_for_timeout(1500)
        check(_cur is not None and page.get_by_text(f"Week {_cur}").count() > 0,
              f"back to week {_cur}" if _cur else "back to current week")
        check(page.locator('[data-testid="week-back-current"]').count() == 0,
              "back-to-current pill hidden on current week")

        # 3. Reading accordion
        print("Testing reading accordion...")
        reading_btn = page.locator('[data-testid="week-reading-body"]')
        reading_btn.click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-reading-body-body"]').count() > 0,
              "reading expands in place")
        # Tap again to collapse
        reading_btn.click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-reading-body-body"]').count() == 0,
              "reading collapses on re-tap")

        # 4. Add question
        print("Testing add question...")
        page.locator('[data-testid="week-question-add"]').click()
        page.wait_for_timeout(800)
        check(page.locator('[data-testid="week-question-input"]').count() > 0,
              "question input appears")
        page.locator('[data-testid="week-question-input"]').fill(
            "Test question from browser test")
        page.locator('[data-testid="week-question-save"]').click()
        page.wait_for_timeout(1000)
        check(page.locator('[data-testid="week-question-input"]').count() == 0,
              "question input closes after save")

        # 5. Stopped state
        print("Testing stopped state...")
        page.evaluate("() => window.__nurtureTest.stopPregnancy()")
        page.goto(f"http://localhost:{PORT}/willow/week?testhooks=1",
                  wait_until="networkidle")
        page.wait_for_timeout(3000)
        check(page.get_by_text("Your week view is resting").count() > 0,
              "stopped state shows resting message")
        check(page.locator('[data-testid="week-size-hero"]').count() == 0,
              "stopped: no size hero (no developmental content)")
        check(page.locator('[data-testid="week-highlights"]').count() == 0,
              "stopped: no highlights")
        check(page.get_by_text("View your story").count() > 0,
              "stopped: story button present")

        # 6. Page errors
        check(len(errors) == 0, f"zero page errors (got {len(errors)})")
        for e in errors[:5]:
            print(f"    pageerror: {e[:120]}")

        # Screenshot for the record
        page.screenshot(path="/tmp/week-stopped.png")
        print("  screenshot: /tmp/week-stopped.png")

        browser.close()

    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
