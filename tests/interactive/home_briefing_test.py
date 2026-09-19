#!/usr/bin/env python3
"""
Interactive browser test: Home briefing screen (enriched Home with delight).

Drives the REAL Nurture web UI in real Chromium against a Metro dev
server (proxied as https://nurture.test so the sandbox's localhost block
never bites — same trick as epic4_journal_test.py, proxying instead of
serving dist/, so the test exercises current source without an
`expo export`).

The briefing screen is mounted by the test-only route app/briefing-test.tsx
(only renders with ?testhooks=1), which exposes
`window.__briefingTest = { setStatus(s), seedBriefing(b) }`. Every state is
forced through that seam — the test NEVER hits a real API (requests to
*.supabase.co are aborted at the proxy layer as a backstop).

Run:  python3 tests/interactive/home_briefing_test.py [--keep-open]

Flows:
  1. live      -> 4 routine rows in order (baby, body, know, tips), the
                   "A little wonder" divider, then 3 delight rows
                   (fact + size + one rotating); all start collapsed;
                   tap-to-expand in place; accordion (one open at a time);
                   tap the open row to collapse
  2. generating-> warm spinner message + skeleton shimmer, no rows
  3. offline   -> cached rows + the gentle offline banner ("Updated yesterday")
  4. empty     -> warm empty state with retry button
  5. no-input  -> no composer/mic/input/textarea anywhere on the screen
"""

import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import date, timedelta

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/app-ideas/pregnancy-tracker/nurture-app")
METRO_PORT = 8081
METRO = f"http://127.0.0.1:{METRO_PORT}"
ORIGIN = "https://nurture.test"
BRIEFING_URL = ORIGIN + "/briefing-test?testhooks=1"
WASM_PATH = os.path.join(REPO, "node_modules", "sql.js", "dist", "sql-wasm-browser.wasm")
KEEP_OPEN = "--keep-open" in sys.argv

TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()

ROTATING_TITLES = [
    "For the partner",
    "Traditions",
    "Story of the week",
    "Name of the week",
    "Milestone ahead",
]


def make_briefing(generated_for):
    return {
        "week": 28,
        "day": 3,
        "generatedForDate": generated_for,
        "reviewDate": "2026-08-15",
        "cards": [
            {
                "id": "baby",
                "title": "Baby's development",
                "subtitle": "About the size of an eggplant",
                "body": [
                    "BABY_MARKER_1: Roughly 15 inches long and just over 2 pounds now.",
                    "BABY_MARKER_2: Sleep is settling into cycles of its own.",
                ],
            },
            {
                "id": "body",
                "title": "Your body this week",
                "subtitle": "The third trimester begins",
                "body": [
                    "BODY_MARKER_1: Many notice backaches and restless sleep.",
                    "BODY_MARKER_2: Feeling breathless on the stairs is common too.",
                ],
            },
            {
                "id": "know",
                "title": "Good to know",
                "subtitle": "Commonly due around now",
                "body": [
                    "KNOW_MARKER_1: The glucose screening test usually happens between weeks 24 and 28.",
                    "KNOW_MARKER_2: Many providers start talking about kick counting around now.",
                ],
            },
            {
                "id": "tips",
                "title": "Tips",
                "subtitle": "Small, practical, warm",
                "body": [
                    "TIPS_MARKER_1: A pillow between the knees makes side-sleeping more comfortable.",
                    "TIPS_MARKER_2: Keep water within reach; thirst tends to ramp up now.",
                ],
            },
        ],
    }


def start_metro():
    # A crashed earlier run can leave a stale dev server on the port, which
    # would serve an outdated bundle — clear it before booting a fresh one.
    # (The [e] trick keeps pkill from matching its own command line.)
    subprocess.run(
        ["pkill", "-f", r"[e]xpo start --web.*--port " + str(METRO_PORT)],
        capture_output=True,
    )
    time.sleep(1)
    env = dict(os.environ, BROWSER="none", CI="1")
    proc = subprocess.Popen(
        ["npx", "expo", "start", "--web", "--non-interactive", "--port", str(METRO_PORT)],
        cwd=REPO,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(METRO + "/", timeout=5) as r:
                if r.status == 200:
                    return proc
        except Exception:
            pass
        if proc.poll() is not None:
            raise RuntimeError("metro exited during boot")
        time.sleep(2)
    proc.terminate()
    raise RuntimeError("metro did not become ready in 240s")


def fetch_from_metro(target_path):
    """GET target_path from the Metro dev server; returns (status, headers, body)."""
    target = METRO + target_path
    ureq = urllib.request.Request(target, method="GET")
    try:
        with urllib.request.urlopen(ureq, timeout=90) as resp:
            body = resp.read()
            headers = {}
            ctype = resp.headers.get("Content-Type")
            if ctype:
                headers["content-type"] = ctype
            return resp.status, headers, body
    except urllib.error.HTTPError as e:
        return e.code, {}, e.read()
    except Exception as e:
        return 502, {}, f"metro proxy error: {e}".encode()


def serve(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path_q = url[len(ORIGIN):]
    path = path_q.split("?", 1)[0]
    query = path_q.split("?", 1)[1] if "?" in path_q else ""
    if path == "/sql-wasm-browser.wasm" and os.path.isfile(WASM_PATH):
        with open(WASM_PATH, "rb") as f:
            return route.fulfill(
                status=200, body=f.read(), content_type="application/wasm"
            )
    # Try the real path first (bundles like /index.bundle have no extension).
    status, headers, body = fetch_from_metro(path_q)
    if status == 404:
        # SPA fallback: serve the root HTML so expo-router renders the deep
        # link client-side.
        status, headers, body = fetch_from_metro("/?" + query if query else "/")
    return route.fulfill(status=status, headers=headers, body=body)


def main():
    failures = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name + (f": {detail}" if detail else ""))

    metro = start_metro()
    print("metro ready on", METRO)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/opt/meta-chromium/chrome",
                args=["--autoplay-policy=no-user-gesture-required"],
            )
            ctx = browser.new_context(viewport={"width": 390, "height": 844})
            # Backstop: the test must never reach a real backend — every
            # state is forced through the __briefingTest seam.
            ctx.route("**/*supabase.co*/**", lambda route: route.abort())
            ctx.route("**://nurture.test/**", serve)
            page = ctx.new_page()
            page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))

            # ---- boot ----
            page.goto(BRIEFING_URL, timeout=120000)
            try:
                page.get_by_test_id("briefing-test-root").wait_for(timeout=90000)
                page.wait_for_function("() => !!window.__briefingTest", timeout=30000)
                booted = True
            except Exception:
                booted = False
            check("app boots to briefing test route (seam installed)", booted)
            if not booted:
                print("body text:", page.evaluate("document.body.innerText")[:300])
                browser.close()
                sys.exit(1)

            def force(status, briefing):
                page.evaluate(
                    "([s, b]) => { window.__briefingTest.seedBriefing(b);"
                    " window.__briefingTest.setStatus(s); }",
                    [status, briefing],
                )

            def wait_live():
                force("live", make_briefing(TODAY))
                page.get_by_test_id("briefing-card-tips").wait_for(timeout=15000)
                # Delight cards build in an effect after the briefing lands.
                page.get_by_test_id("delight-card-fact").wait_for(timeout=15000)

            # ---- Flow 1: live — routine rows, divider, delight rows ----
            wait_live()
            for tid, title in [
                ("briefing-card-baby", "Baby's development"),
                ("briefing-card-body", "Your body this week"),
                ("briefing-card-know", "Good to know"),
                ("briefing-card-tips", "Tips"),
                ("delight-card-fact", "Did you know?"),
                ("delight-card-size", "How big is Mira?"),
                ("delight-card-rotating", None),
            ]:
                row = page.get_by_test_id(tid)
                check(f"flow1: {tid} renders", row.count() > 0)
                if title:
                    check(f"flow1: {tid} shows title {title!r}",
                          row.get_by_text(title, exact=True).count() > 0)

            rot_text = page.get_by_test_id("delight-card-rotating").inner_text()
            check("flow1: rotating card is one of the 5 kinds",
                  any(t in rot_text for t in ROTATING_TITLES), f"text={rot_text[:60]!r}")

            # Week-28 size card is deterministic (fixed per-week mapping).
            size_text = page.get_by_test_id("delight-card-size").inner_text()
            check("flow1: week-28 size card mentions the bowling pin",
                  "bowling pin" in size_text, f"size={size_text[:90]!r}")

            # DOM order: 4 routine rows -> divider -> 3 delight rows.
            order_ok = page.evaluate("""() => {
              const ids = ['briefing-card-baby','briefing-card-body','briefing-card-know',
                           'briefing-card-tips','briefing-wonder-divider',
                           'delight-card-fact','delight-card-size','delight-card-rotating'];
              const els = ids.map(id => document.querySelector(`[data-testid="${id}"]`));
              if (els.some(e => !e)) return 'missing: ' + ids[els.findIndex(e => !e)];
              for (let i = 1; i < els.length; i++) {
                if (!(els[i-1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING))
                  return 'out of order at ' + ids[i];
              }
              return 'ok';
            }""")
            check("flow1: routine rows, divider, then delight rows in order", order_ok == "ok", order_ok)
            divider_text = page.get_by_test_id("briefing-wonder-divider").inner_text()
            check("flow1: divider reads 'A little wonder'",
                  "a little wonder" in divider_text.lower(),
                  f"divider={divider_text!r}")

            header = page.get_by_test_id("briefing-header").inner_text()
            check("flow1: header eyebrow shows week/day/weeks-to-go",
                  "WEEK 28" in header and "DAY 3" in header and "12 WEEKS TO GO" in header,
                  f"header={header[:80]!r}")
            check("flow1: header title present", "What's happening this week" in header)
            updated = page.get_by_test_id("briefing-updated").inner_text()
            check("flow1: subtitle says Updated today", "Updated today" in updated, f"updated={updated!r}")
            disclaimer = page.get_by_test_id("briefing-disclaimer").inner_text()
            check("flow1: disclaimer footer present",
                  "Not medical advice" in disclaimer and "Reviewed Aug 2026" in disclaimer,
                  f"disclaimer={disclaimer!r}")

            # ---- Flow 1b: rows start collapsed; tap to expand in place ----
            baby = page.get_by_test_id("briefing-card-baby")
            check("flow1b: baby row starts collapsed (body hidden)",
                  "BABY_MARKER_1" not in baby.inner_text())
            baby.get_by_text("Baby's development", exact=True).click()
            try:
                page.wait_for_function(
                    "() => document.querySelector('[data-testid=\"briefing-card-baby\"]')"
                    ".innerText.includes('BABY_MARKER_1')",
                    timeout=8000)
                baby_open = True
            except Exception:
                baby_open = False
            check("flow1b: tapping the baby row expands it in place", baby_open)

            # ---- Flow 1c: accordion — opening another closes the first ----
            body_row = page.get_by_test_id("briefing-card-body")
            body_row.get_by_text("Your body this week", exact=True).click()
            try:
                page.wait_for_function(
                    "() => document.querySelector('[data-testid=\"briefing-card-body\"]')"
                    ".innerText.includes('BODY_MARKER_1')",
                    timeout=8000)
                body_open = True
            except Exception:
                body_open = False
            check("flow1c: tapping the body row expands it", body_open)
            check("flow1c: accordion closed the baby row",
                  "BABY_MARKER_1" not in baby.inner_text())
            check("flow1c: exactly one row open",
                  page.evaluate("""() => {
                    const ids = ['briefing-card-baby','briefing-card-body','briefing-card-know',
                                 'briefing-card-tips','delight-card-fact','delight-card-size','delight-card-rotating'];
                    const markers = ['BABY_MARKER_1','BODY_MARKER_1','KNOW_MARKER_1','TIPS_MARKER_1'];
                    let open = 0;
                    for (const m of markers) {
                      if (document.body.innerText.includes(m)) open++;
                    }
                    return open;
                  }""") == 1)

            # ---- Flow 1d: tapping the open row collapses it ----
            body_row.get_by_text("Your body this week", exact=True).click()
            try:
                page.wait_for_function(
                    "() => !document.querySelector('[data-testid=\"briefing-card-body\"]')"
                    ".innerText.includes('BODY_MARKER_1')",
                    timeout=8000)
                body_closed = True
            except Exception:
                body_closed = False
            check("flow1d: tapping the open row collapses it", body_closed)

            # ---- Flow 1e: delight rows expand too ----
            fact = page.get_by_test_id("delight-card-fact")
            fact.get_by_text("Did you know?", exact=True).click()
            try:
                page.wait_for_function(
                    """() => {
                      const t = document.querySelector('[data-testid="delight-card-fact"]').innerText;
                      return t.split('\\n').length > 3;
                    }""",
                    timeout=8000)
                fact_open = True
            except Exception:
                fact_open = False
            check("flow1e: tapping the fact row expands it", fact_open)

            # ---- Flow 2: generating — spinner + skeletons, no rows ----
            force("generating", None)
            try:
                page.get_by_text("Putting your week together").wait_for(timeout=15000)
                gen_ready = True
            except Exception:
                gen_ready = False
            check("flow2: generating shows warm spinner message", gen_ready)
            check("flow2: generating shows no briefing rows",
                  page.get_by_test_id("briefing-card-baby").count() == 0
                  and page.get_by_test_id("delight-card-fact").count() == 0)
            check("flow2: generating shows shimmer copy",
                  page.get_by_text("your briefing will appear here").count() > 0)

            # ---- Flow 3: offline — cached rows + banner ----
            force("offline", make_briefing(YESTERDAY))
            try:
                page.get_by_test_id("briefing-offline-banner").wait_for(timeout=15000)
                off_ready = True
            except Exception:
                off_ready = False
            check("flow3: offline shows the sage banner", off_ready)
            banner = page.get_by_test_id("briefing-offline-banner").inner_text()
            check("flow3: banner copy is gentle", "You're offline" in banner,
                  f"banner={banner[:80]!r}")
            page.get_by_test_id("delight-card-fact").wait_for(timeout=15000)
            check("flow3: offline still shows cached rows + delight",
                  page.get_by_test_id("briefing-card-baby").count() > 0
                  and page.get_by_test_id("delight-card-size").count() > 0)
            updated_off = page.get_by_test_id("briefing-updated").inner_text()
            check("flow3: subtitle says Updated yesterday", "Updated yesterday" in updated_off,
                  f"updated={updated_off!r}")

            # ---- Flow 4: empty — warm empty state with retry ----
            force("empty", None)
            try:
                page.get_by_test_id("briefing-retry").wait_for(timeout=15000)
                empty_ready = True
            except Exception:
                empty_ready = False
            check("flow4: empty state shows retry button", empty_ready)
            check("flow4: empty state copy is warm",
                  page.get_by_text("Your briefing will appear here").count() > 0)

            # ---- Flow 5: Home is cards only — no input surface anywhere ----
            wait_live()
            n_inputs = page.locator("input, textarea").count()
            check("flow5: no input/textarea elements on the briefing screen", n_inputs == 0,
                  f"found {n_inputs}")
            body_text = page.get_by_test_id("briefing-test-root").inner_text().lower()
            check("flow5: no mic affordance text",
                  "tap to talk" not in body_text and "dictat" not in body_text)

            if KEEP_OPEN:
                print("keeping browser open (--keep-open); Ctrl-C to exit")
                try:
                    while True:
                        time.sleep(60)
                except KeyboardInterrupt:
                    pass
            browser.close()
    finally:
        metro.terminate()
        try:
            metro.wait(timeout=10)
        except subprocess.TimeoutExpired:
            metro.kill()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("ALL HOME BRIEFING BROWSER TESTS PASSED")


if __name__ == "__main__":
    main()
