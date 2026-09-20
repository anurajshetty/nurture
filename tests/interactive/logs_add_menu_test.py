#!/usr/bin/env python3
"""
Interactive test: Logs-tab Add button (Anuraj-approved Sept 2026).

The circular + button REPLACES the old "Save a moment..." composer bar on
the Logs tab. Tap -> light scrim + three pills (Appointment / Add report /
Log entry). Tap x, the scrim, or any pill to fold the menu away.

Run:  python3 tests/interactive/logs_add_menu_test.py [--keep-open]
Must stay green before any push that touches the Logs tab.

Serving: by default the suite serves the committed web export from dist/
(./dist is git-ignored; rebuild it with `expo export` after source changes).
Set NURTURE_DEV=1 to serve the Metro dev server instead — compiled live from
current source, so style/visual changes are testable without an export
(Chromium can't reach localhost here, so the dev server is proxied through
the https://nurture.test route; the /willow subpath is dropped because the
dev server has no baseUrl). The open-menu visual checks (section A2) only run
under NURTURE_DEV=1, since they assert the current source's styles.

Flows:
  A. menu open/close: button label Add <-> Close add menu; close via x and
     via the scrim; old composer bar is gone.
  B. Appointment: fill the intake sheet, save -> the app navigates to the
     Plan tab's ?appointment=<id> detail; the event also lands in the
     timeline (onSaved still fires).
  C. Add report: Choose file -> upload row ends in a check, Done toasts and
     closes (file selection stubbed at the test boundary via filechooser).
  D. Log entry: the real composer floats above a light scrim (no sheet
     chrome, mood pill hidden, photo-only [+]).
     - text -> ink send arrow -> "Saved to your story" toast, settles away
     - photo-only -> blush mic shown, tapping it saves
     - dictation -> transcript lands in the field (FakeSpeechRecognition)
  E. zero page errors throughout.
"""
import mimetypes
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voice_browser_test import FAKE_SR_JS  # noqa: E402

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
NURTURE_DEV = os.environ.get("NURTURE_DEV") == "1"
METRO = "http://localhost:8081"
if NURTURE_DEV:
    # Metro dev has no /willow baseUrl — expo-router would 404 /willow/* as
    # an unmatched route, so drop the subpath in dev mode.
    BASE = ORIGIN + "/?testhooks=1"
    LOGS = ORIGIN + "/logs?testhooks=1"
else:
    BASE = ORIGIN + "/willow/?testhooks=1"
    LOGS = ORIGIN + "/willow/logs?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv
# Dev bundling is slow on first hit; the prod export serves instantly.
NAV_TIMEOUT = 120000 if NURTURE_DEV else 30000
HOOK_TIMEOUT = 120000 if NURTURE_DEV else 30000

REPORT_PDF = "/tmp/willow-test-report.pdf"
PHOTO_PNG = "/tmp/willow-test-photo.png"


def make_fixtures():
    with open(REPORT_PDF, "wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n")
    # Minimal 1x1 PNG.
    import base64
    with open(PHOTO_PNG, "wb") as f:
        f.write(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9Q"
            "DwADhgGAWjR9awAAAABJRU5ErkJggg=="))


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


WASM_DIR = os.path.join(REPO, "node_modules", "sql.js", "dist")
WASM_FILES = {
    "/sql-wasm.wasm": os.path.join(WASM_DIR, "sql-wasm.wasm"),
    "/sql-wasm-browser.wasm": os.path.join(WASM_DIR, "sql-wasm-browser.wasm"),
}


def serve_metro(route):
    """NURTURE_DEV=1: proxy the Metro dev server (fresh source, no export).

    Chromium blocks localhost in this sandbox, so the browser talks to
    https://nurture.test and this handler fetches from Metro over the exec
    side's loopback. The /willow subpath is already dropped from BASE/LOGS.
    """
    import urllib.request
    url = route.request.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if "?" in path:
        path, qs = path.split("?", 1)
        qs = "?" + qs
    else:
        qs = ""
    # The web DB (db.web.ts) loads sql.js WASM relative to the page URL;
    # Metro dev doesn't serve it, so hand it the real file directly.
    if path in WASM_FILES and os.path.isfile(WASM_FILES[path]):
        with open(WASM_FILES[path], "rb") as f:
            body = f.read()
        return route.fulfill(status=200, body=body, content_type="application/wasm")
    try:
        with urllib.request.urlopen(METRO + path + qs, timeout=90) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type", "application/octet-stream")
    except Exception as e:
        return route.fulfill(status=502, body=f"metro proxy fail: {e}")
    return route.fulfill(status=200, body=body, content_type=ctype)


# Dev-only: hide Expo's error overlay (it swallows clicks and would ruin
# screenshots; prod/dist builds never render it). documentElement may not
# exist yet when init scripts run, so poll.
OVERLAY_HIDE_JS = """(() => { const t = setInterval(() => {
  if (document.documentElement) {
    const s = document.createElement('style');
    s.textContent = '#error-overlay{display:none!important}';
    document.documentElement.appendChild(s);
    clearInterval(t);
  } }, 50); })();"""


def seed_with_retry(page, timeout_s=40):
    """completeOnboarding + clearEvents + seedPregnancy, retrying until the
    web DB (async WASM init) is ready. Returns True on success."""
    import time as _time
    deadline = _time.time() + timeout_s
    while _time.time() < deadline:
        try:
            page.evaluate(
                "() => { const t = window.__nurtureTest; "
                "t.completeOnboarding(); t.clearEvents(); "
                "t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }")
            return True
        except Exception:
            page.wait_for_timeout(1000)
    return False


def menu_visual_metrics(page):
    """Measured geometry + computed styles of the open add-menu, keyed by
    pill. Used by the section-A2 mockup-match checks."""
    return page.evaluate("""() => {
      const out = {};
      const ids = {
        appointment: 'add-menu-pill-appointment',
        report: 'add-menu-pill-report',
        log: 'add-menu-pill-log',
      };
      for (const [k, id] of Object.entries(ids)) {
        const el = document.querySelector('[data-testid="' + id + '"]');
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const icon = el.firstElementChild;
        const ir = icon.getBoundingClientRect();
        const ics = getComputedStyle(icon);
        const label = el.lastElementChild;
        const lcs = getComputedStyle(label);
        out[k] = {
          w: r.width, h: r.height, x: r.x, y: r.y,
          bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
          borderW: cs.borderTopWidth,
          iconW: ir.width, iconH: ir.height, iconBg: ics.backgroundColor,
          labelColor: lcs.color, labelWeight: lcs.fontWeight,
          labelSize: lcs.fontSize,
        };
      }
      out.scrim = getComputedStyle(
        document.querySelector('[data-testid="add-menu-scrim"]')).backgroundColor;
      return out;
    }""")


def norm_css(c):
    return c.replace(" ", "").lower()


def main():
    failures = []
    page_errors = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    make_fixtures()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(FAKE_SR_JS)
        if NURTURE_DEV:
            ctx.add_init_script(OVERLAY_HIDE_JS)
            ctx.route("**://nurture.test/**", serve_metro)
        else:
            ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(BASE, timeout=NAV_TIMEOUT)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=HOOK_TIMEOUT)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        check("db ready + seeded", seed_with_retry(page))
        page.goto(LOGS, timeout=NAV_TIMEOUT)
        try:
            page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        except Exception:
            check("logs screen boots", False)
            browser.close()
            sys.exit(1)
        check("logs screen boots", True)

        add_btn = page.get_by_test_id("logs-add-button")
        try:
            add_btn.wait_for(timeout=10000)
        except Exception:
            check("add button renders", False)
        else:
            check("add button renders", True)
        check("add button labeled Add when closed",
              add_btn.get_attribute("aria-label") == "Add")
        check("old composer bar is gone",
              page.get_by_role("textbox", name="Save a moment").count() == 0)
        # + button: 72px floating over the feed (Anuraj Sept 2026 — the old
        # ~110px button ate too much feed); no container box around it.
        box = add_btn.bounding_box()
        check("add button is 72px", box is not None
              and abs(box["width"] - 72) <= 2 and abs(box["height"] - 72) <= 2)
        # Locked position (mockup 15, supersedes mockup 13 centering):
        # bottom-right, 18px from the right edge, just above the tab bar.
        if box is not None:
            check("add button pinned bottom-right (18px from right edge)",
                  abs(box["x"] + box["width"] - 372) <= 6,
                  f"right={box['x'] + box['width']:.1f}")
        else:
            check("add button pinned bottom-right (18px from right edge)", False)
        bar_bg = page.evaluate(
            "() => { const el = document.querySelector('[data-testid=\"logs-add-button\"]').parentElement;"
            " const cs = getComputedStyle(el);"
            " return cs.backgroundColor + '|' + cs.position; }")
        check("add button floats (absolute, transparent wrapper)",
              bar_bg.endswith("|absolute") and bar_bg.startswith("rgba(0, 0, 0, 0)"))

        # ---- A. menu open/close ----
        add_btn.click()
        try:
            page.get_by_test_id("add-menu").wait_for(timeout=5000)
        except Exception:
            check("menu opens on tap", False)
        else:
            check("menu opens on tap", True)
        check("three pills render",
              page.get_by_test_id("add-menu-pill-appointment").count() == 1
              and page.get_by_test_id("add-menu-pill-report").count() == 1
              and page.get_by_test_id("add-menu-pill-log").count() == 1)
        check("button labeled Close add menu when open",
              add_btn.get_attribute("aria-label") == "Close add menu")
        # Close via the x (the same button).
        add_btn.click()
        page.wait_for_timeout(400)
        check("menu closes via x", page.get_by_test_id("add-menu").count() == 0)
        check("button labeled Add after close",
              add_btn.get_attribute("aria-label") == "Add")
        # Close via the scrim (tap a clear spot above the fanned pills —
        # the pills are large per the mockup and cover the screen center).
        add_btn.click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-scrim").click(position={"x": 195, "y": 100})
        page.wait_for_timeout(400)
        check("menu closes via scrim", page.get_by_test_id("add-menu").count() == 0)

        # ---- A2. open-menu visuals vs design/13-logs-add.html ----
        # Needs a fresh bundle: with the default stale dist these are
        # skipped — run with NURTURE_DEV=1 (Metro, current source).
        if not NURTURE_DEV:
            print("SKIP open-menu visuals (needs NURTURE_DEV=1 or a rebuilt dist)")
        else:
            add_btn.click()
            page.get_by_test_id("add-menu").wait_for(timeout=15000)
            page.wait_for_timeout(600)  # let the entrance settle
            open_box = add_btn.bounding_box()
            check("open-state x stays 72px", open_box is not None
                  and abs(open_box["width"] - 72) <= 2
                  and abs(open_box["height"] - 72) <= 2,
                  f"box={open_box}")
            m = menu_visual_metrics(page)
            check("scrim is the light warm dim rgba(47,43,39,.30)",
                  norm_css(m["scrim"]) == "rgba(47,43,39,0.3)", m["scrim"])
            expected_icon = {
                "appointment": "rgb(142,124,195)",   # #8E7CC3
                "report": "rgb(127,168,201)",        # #7FA8C9
                "log": "rgb(147,177,146)",           # #93B192
            }
            prev_bottom = None
            for k in ("appointment", "report", "log"):
                pm = m[k]
                check(f"pill {k}: 60px tall", abs(pm["h"] - 60) <= 4, f"h={pm['h']:.1f}")
                check(f"pill {k}: min 238px wide", pm["w"] >= 236, f"w={pm['w']:.1f}")
                check(f"pill {k}: white",
                      norm_css(pm["bg"]) in ("rgb(255,255,255)", "rgba(255,255,255,1)"), pm["bg"])
                try:
                    round_enough = float(pm["radius"].replace("px", "")) >= 29
                except ValueError:
                    round_enough = False
                check(f"pill {k}: full-round (999px)", pm["radius"] == "999px" or round_enough,
                      pm["radius"])
                check(f"pill {k}: borderless", pm["borderW"] in ("0px", "0"), pm["borderW"])
                check(f"pill {k}: icon 44px",
                      abs(pm["iconW"] - 44) <= 3 and abs(pm["iconH"] - 44) <= 3,
                      f"{pm['iconW']:.1f}x{pm['iconH']:.1f}")
                check(f"pill {k}: icon color", norm_css(pm["iconBg"]) == expected_icon[k],
                      pm["iconBg"])
                check(f"pill {k}: dark ink label", norm_css(pm["labelColor"]) == "rgb(47,43,39)",
                      pm["labelColor"])
                check(f"pill {k}: label 700/15.5px",
                      pm["labelWeight"] == "700" and pm["labelSize"] == "15.5px",
                      f"{pm['labelWeight']}/{pm['labelSize']}")
                cx = pm["x"] + pm["w"] / 2
                check(f"pill {k}: right-aligned to button (right edge ~372px)",
                      abs(pm["x"] + pm["w"] - 372) <= 8,
                      f"right={pm['x'] + pm['w']:.1f}")
                if prev_bottom is not None:
                    gap = pm["y"] - prev_bottom
                    check(f"pill {k}: 10px gap above", abs(gap - 10) <= 3, f"gap={gap:.1f}")
                prev_bottom = pm["y"] + pm["h"]
            pill_x_gap = open_box["y"] - prev_bottom
            check("14px-ish gap pill -> x button", 8 <= pill_x_gap <= 24,
                  f"gap={pill_x_gap:.1f}")
            check("x button pinned bottom-right (right edge ~372px)",
                  abs(open_box["x"] + open_box["width"] - 372) <= 6,
                  f"right={open_box['x'] + open_box['width']:.1f}")
            # Fold the menu away so section B starts from the closed state.
            add_btn.click()
            page.wait_for_timeout(400)
            check("menu closes after visuals", page.get_by_test_id("add-menu").count() == 0)

        # ---- B. Appointment ----
        add_btn.click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-appointment").click()
        try:
            page.get_by_test_id("appointment-sheet").wait_for(timeout=5000)
        except Exception:
            check("appointment sheet opens", False)
        else:
            check("appointment sheet opens", True)
        page.get_by_test_id("appointment-what").fill("Growth scan")
        page.get_by_test_id("appointment-where").fill("Dr. Izu")
        page.get_by_test_id("appointment-time").fill("14:30")
        page.get_by_test_id("appointment-save").click()
        page.wait_for_timeout(500)
        check("appointment sheet closes after save",
              page.get_by_test_id("appointment-sheet").count() == 0)
        # Saving opens the appointment in the Logs-tab editor (Plan tab was
        # removed Sept 2026) — the app itself pushes /logs?appointment=<id>.
        try:
            page.get_by_test_id("appointment-editor").wait_for(timeout=10000)
        except Exception:
            check("appointment opens in editor after save", False,
                  "appointment-editor never appeared")
        else:
            body = page.evaluate("document.body.innerText")
            check("appointment opens in editor after save", "Dr. Izu" in body)
        event_id = page.evaluate(
            "() => new URL(window.location.href).searchParams.get('appointment')")
        check("appointment event id found", bool(event_id), f"id={event_id}")
        # Back to Logs: onSaved still fired, so the event is in the timeline.
        page.goto(LOGS, timeout=30000)
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        try:
            page.get_by_text("Growth scan").first.wait_for(timeout=8000)
        except Exception:
            check("appointment lands in timeline", False)
        else:
            check("appointment lands in timeline", True)

        # ---- C. Add report ----
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-report").click()
        try:
            page.get_by_test_id("report-sheet").wait_for(timeout=5000)
        except Exception:
            check("report sheet opens", False)
        else:
            check("report sheet opens", True)
        check("choose file + scan document offered",
              page.get_by_test_id("report-choose-file").count() == 1
              and page.get_by_test_id("report-scan").count() == 1)
        with page.expect_file_chooser() as fc:
            page.get_by_test_id("report-choose-file").click()
        fc.value.set_files(REPORT_PDF)
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"report-row-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report upload row appears", False)
        else:
            check("report upload row appears", True)
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"report-done-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report row ends in a check", False)
        else:
            check("report row ends in a check", True)
        page.get_by_test_id("report-done").click()
        try:
            page.get_by_test_id("report-toast").wait_for(timeout=5000)
        except Exception:
            check("report done toasts", False)
        else:
            check("report done toasts", True)
        page.wait_for_timeout(2000)
        check("report sheet closes after done",
              page.get_by_test_id("report-sheet").count() == 0)
        # Entry-typing rule (Anuraj Sept 2026): Add report -> ALWAYS a
        # Report entry, never a generic FILE chip.
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('[data-testid^=\"event-card-\"]').length >= 1",
                timeout=10000)
        except Exception:
            check("report lands in timeline", False)
        else:
            check("report lands in timeline", True)
            # Find the report's own card by its summary state (ephemeral flow,
            # Sept 2026: entries are text-only — no raw filename on the card).
            # This suite doesn't stub the edge function, so the card lands in
            # the loading or summary-card state, or — with no Supabase backend
            # wired up — the not-configured setup card (the Sept 2026 setup
            # card, which must never blame the photo). A genuine failure
            # hard-deletes the entry instead (transient toast, no card), so
            # there is no failed-card surface to allow here.
            report_card = page.locator(
                '[data-testid="report-summary-loading"],'
                '[data-testid="report-summary-card"],'
                '[data-testid="report-summary-not-configured"]').first
            try:
                report_card.wait_for(timeout=8000)
            except Exception:
                check("report card found", False)
            else:
                check("report card found", True)
                check("report renders with Report label (not FILE chip)",
                      page.get_by_text("Report", exact=True).count() > 0
                      and "FILE" not in page.evaluate("document.body.innerText"))

        # ---- D. Log entry: floating composer ----
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        try:
            page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        except Exception:
            check("log entry floats the composer", False)
        else:
            check("log entry floats the composer", True)
        check("no sheet chrome / no title",
              page.get_by_test_id("appointment-sheet").count() == 0
              and "Log entry" not in page.evaluate("document.body.innerText"))
        check("mood pill hidden",
              "How are you feeling?" not in page.evaluate("document.body.innerText"))
        field = page.get_by_role("textbox", name="Save a moment")
        check("composer field renders", field.count() == 1)

        # [+] is a dummy while photo persistence is paused (Anuraj, Sept
        # 2026): tapping it toasts "Photo uploads are paused for now" and
        # the attach sheet never opens — nothing attaches.
        page.get_by_role("button", name="Add photo").click()
        try:
            page.wait_for_function(
                "() => document.body.innerText.includes('Photo uploads are paused for now')",
                timeout=5000)
        except Exception:
            check("paused toast shows on [+] tap", False)
        else:
            check("paused toast shows on [+] tap", True)
        sheet_text = page.evaluate("document.body.innerText")
        check("no attach sheet opens",
              "Take a photo" not in sheet_text and "Photo library" not in sheet_text
              and "Add a photo" not in sheet_text)

        # Text -> ink send arrow -> toast -> settles away.
        field.fill("Hello little one")
        send_btn = page.get_by_role("button", name="Save moment")
        try:
            send_btn.wait_for(timeout=5000)
        except Exception:
            check("text send state (Save moment)", False)
        else:
            check("text send state (Save moment)", True)
        send_btn.click()
        try:
            page.get_by_test_id("floating-composer-toast").wait_for(timeout=8000)
        except Exception:
            check("save toasts 'Saved to your story'", False)
        else:
            toast_text = page.get_by_test_id("floating-composer-toast").inner_text()
            check("save toasts 'Saved to your story'", "Saved to your story" in toast_text,
                  f"toast={toast_text!r}")
        page.wait_for_timeout(3000)
        check("composer settles away after save",
              page.get_by_test_id("floating-composer").count() == 0)
        check("saved text lands in timeline",
              page.get_by_text("Hello little one").count() >= 1)

        # Photo-only save RETIRED (Sept 2026): photo persistence is OFF
        # app-wide — the composer [+] is a dummy ("Photo uploads are paused
        # for now") and no photo can attach, so there is no photo-only save
        # path to exercise. Text-only save is covered above. When
        # persistence returns, restore this block (attach via the [+] sheet,
        # mic tap saves the photo-only moment).

        # Dictation -> transcript enters the field for review.
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        page.get_by_role("button", name="Dictate a moment").click()
        try:
            page.get_by_role("button", name="Stop dictation").wait_for(timeout=8000)
        except Exception:
            check("dictation listening UI appears", False)
        else:
            check("dictation listening UI appears", True)
        page.wait_for_timeout(400)
        page.evaluate("window.__srDriver.emitInterim('dreaming of tiny socks')")
        page.wait_for_timeout(400)
        field2 = page.get_by_role("textbox", name="Save a moment")
        field_val = field2.input_value() or ""
        check("dictation transcript lands in field", "tiny socks" in field_val,
              f"field={field_val!r}")
        page.get_by_role("button", name="Stop dictation").click()
        page.wait_for_timeout(3500)  # > stop grace + restart window
        field_val2 = field2.input_value() or ""
        check("transcript kept after stop", len(field_val2.strip()) > 0,
              f"field={field_val2!r}")
        try:
            page.get_by_role("button", name="Save moment").wait_for(timeout=10000)
        except Exception:
            check("send returns after dictation", False)
        else:
            check("send returns after dictation", True)
            page.get_by_role("button", name="Save moment").click()
            try:
                page.get_by_test_id("floating-composer-toast").wait_for(timeout=8000)
            except Exception:
                check("dictated entry saves", False)
            else:
                check("dictated entry saves", True)

        # ---- E. zero page errors ----
        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl+C to exit")
            while True:
                time.sleep(3600)
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nlogs_add_menu: all green")


if __name__ == "__main__":
    main()
