#!/usr/bin/env python3
"""
Report-summary interactive test — the EPHEMERAL flow (Anuraj Sept 2026).

Drives the REAL "Add report" UI in Chromium against the web export
served under /willow/ (with ?testhooks=1): Add button → Add report →
Choose file → file chooser → Done.

Ephemeral contract under test:
- The picked file is read into memory ONLY; the invoke body carries
  EXACTLY { dataBase64, mimeType } — no Storage pointers, no event id,
  no attachments, no media-outbox rows, no "Backing up…" anywhere, and
  report bytes are never persisted.
- Feed entries are text-only: "Summarizing your report…" interim →
  title/body/fixed-disclaimer card → failure card with Try again.

`functions.invoke` is stubbed AT THE NETWORK LAYER: the app still
crosses a real fetch boundary (via the testhooks-gated transport in
src/reportSummary/client.ts) — a same-origin POST to
/functions/v1/report-summary on the test server below. No real Supabase
or Gemini traffic.

Covers:
  (a) success: "Summarizing your report…" interim while the stub holds
      the response; invoke body is exactly {dataBase64, mimeType} and
      the base64 decodes to the fixture bytes; summary card renders with
      title/body/fixed disclaimer; no attachment card, no Open button,
      no "Backing up…", no raw filename on the entry.
  (b) failure: a second report with the stub failing → "Couldn't read
      this one" card + Try again. NO page reload between phases —
      the bytes are intentionally memory-only, so a reload would wipe
      the retry path this test is proving.
  (c) retry: stub flips to success, Try again → the second summary card.
  (d) zero page errors throughout.

Run: python3 tests/interactive/report_summary_test.py
"""

import base64
import http.server
import socketserver
import threading
import os
import time
import json

DIST = os.path.expanduser("~/workspace/nurture-v12/dist")
PORT = 8913
# RS_PROXY_DEV=1: run the test through a reverse proxy to a Metro dev
# server (RS_DEV_TARGET, default http://localhost:8083) instead of the
# dist/ export — verifies new UI code without running `expo export`
# (which would stomp the shared dist/). The dev server ignores
# experiments.baseUrl, so the app is served at its root there: the
# proxy strips the /willow prefix when forwarding, and the page is
# loaded at the proxy root (no WEB_DEPLOY=1 needed). The proxy also
# intercepts /sql-wasm-browser.wasm and serves the real sql.js bytes
# with the correct MIME type (Metro dev serves it as text/html, which
# breaks sql.js on web). Everything else is forwarded to the dev server.
PROXY_DEV = os.environ.get("RS_PROXY_DEV") == "1"
DEV_TARGET = os.environ.get("RS_DEV_TARGET", "http://localhost:8083")
WASM_FILE = os.path.expanduser(
    "~/workspace/nurture-v12/node_modules/sql.js/dist/sql-wasm-browser.wasm"
)
BASE = os.environ.get("RS_BASE", f"http://localhost:{PORT}/willow/?testhooks=1")
LOGS = os.environ.get("RS_LOGS", f"http://localhost:{PORT}/willow/logs?testhooks=1")
if PROXY_DEV:
    # The dev server ignores experiments.baseUrl, so the app is served at
    # the root there — the proxy strips the /willow prefix when forwarding.
    BASE = os.environ.get("RS_BASE", f"http://localhost:{PORT}/?testhooks=1")
    LOGS = os.environ.get("RS_LOGS", f"http://localhost:{PORT}/logs?testhooks=1")
# Dev HMR keeps a websocket open, so networkidle never fires there.
LOAD_WAIT = "domcontentloaded" if PROXY_DEV else "networkidle"

STUB_URL_PATH = "/functions/v1/report-summary"

SUMMARY_200 = {
    "title": "Growth scan",
    "summary": "Your growth scan looks typical for this stage — a routine check your care team is already watching.",
    "attachmentName": "Growth scan – Sep 19",
    "needsAttention": False,
    # The card renders the app-side FIXED disclaimer (Anuraj, Sept 19, 2026):
    # "This isn't medical advice." — never model-written. The mocked function
    # response below carries the edge function's own contract disclaimer.
    "disclaimer": "This isn't medical advice — check with your care team.",
}

FIXTURE_1 = "/tmp/willow-test-report.pdf"
FIXTURE_2 = "/tmp/willow-test-report-2.pdf"


def make_fixtures():
    # Minimal PDF-ish bytes — distinct per fixture so the base64
    # round-trip assertion can tell them apart. The app never parses the
    # PDF; Gemini is stubbed. The .pdf extension is what matters: it is
    # how the picker reports mimeType application/pdf.
    with open(FIXTURE_1, "wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\n"
                b"willow-ephemeral-report-one\ntrailer\n")
    with open(FIXTURE_2, "wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\n"
                b"willow-ephemeral-report-two\ntrailer\n")


# Mutable stub behavior, flipped by the test between phases.
stub_state = {"mode": "delayed-success"}
seen_requests = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def _send_json(self, status, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # The edge-function stub: same-origin POST, so no CORS preflight.
        # The app still crosses a real fetch boundary via the
        # testhooks-gated transport (src/reportSummary/client.ts).
        path = self.path.split("?")[0]
        if path != STUB_URL_PATH:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            seen_requests.append(json.loads(raw or b"{}"))
        except Exception:
            seen_requests.append(None)
        mode = stub_state["mode"]
        if mode == "failure":
            self._send_json(500, b'{"error":"boom"}')
        elif mode == "delayed-success":
            # Hold the response so "Summarizing your report…" stays
            # observable while the test closes the sheet and locates it.
            time.sleep(5)
            self._send_json(200, json.dumps(SUMMARY_200).encode())
        else:
            self._send_json(200, json.dumps(SUMMARY_200).encode())

    def proxy_dev(self):
        """Reverse-proxy to the Metro dev server, fixing the wasm MIME type.

        The dev server ignores experiments.baseUrl, so it serves the app at
        its root: /willow is stripped when forwarding (the page itself is
        loaded at the proxy root, so relative URLs like the wasm and the
        edge-function stub keep working).
        """
        from urllib.request import Request, urlopen

        path = self.path.split("?")[0]
        query = self.path[len(path):]
        if path in ("/sql-wasm-browser.wasm", "/willow/sql-wasm-browser.wasm"):
            with open(WASM_FILE, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/wasm")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/willow/"):
            path = path[len("/willow"):]
        elif path == "/willow":
            path = "/"
        target = DEV_TARGET + path + query
        try:
            req = Request(target, headers={"User-Agent": self.headers.get("User-Agent", "playwright")})
            with urlopen(req, timeout=90) as r:
                body = r.read()
                self.send_response(r.status)
                self.send_header("Content-Type", r.headers.get("Content-Type", "application/octet-stream"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except Exception as e:
            self.send_error(502, str(e)[:120])

    def do_GET(self):
        if PROXY_DEV:
            return self.proxy_dev()
        # Strip the /willow subpath; SPA fallback to index.html
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


# The test transport: installed before the app boots. Same-origin POST
# to the stub above — a real fetch, intercepted by the test server.
INIT_SCRIPT = """
window.__reportSummaryTestTransport = {
  invoke: async (body) => {
    const res = await fetch('/functions/v1/report-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) return { data, error: { message: 'stub http ' + res.status } };
    return { data, error: null };
  },
};
"""


def add_report_via_ui(page, check, fixture_path, phase):
    """Drives Add → Add report → Choose file → file chooser → Done."""
    page.get_by_test_id("logs-add-button").click()
    try:
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
    except Exception:
        check(False, f"({phase}) add menu opens")
        return False
    check(True, f"({phase}) add menu opens")
    page.get_by_test_id("add-menu-pill-report").click()
    try:
        page.get_by_test_id("report-sheet").wait_for(timeout=5000)
    except Exception:
        check(False, f"({phase}) report sheet opens")
        return False
    check(True, f"({phase}) report sheet opens")
    with page.expect_file_chooser() as fc:
        page.get_by_test_id("report-choose-file").click()
    fc.value.set_files(fixture_path)
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid^=\"report-row-\"]').length >= 1",
            timeout=10000)
    except Exception:
        check(False, f"({phase}) picked file row appears")
        return False
    check(True, f"({phase}) picked file row appears")
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid^=\"report-done-\"]').length >= 1",
            timeout=10000)
    except Exception:
        check(False, f"({phase}) row finishes reading (check badge)")
        return False
    check(True, f"({phase}) row finishes reading (check badge)")
    page.get_by_test_id("report-done").click()
    page.wait_for_timeout(2200)  # toast (1.5s) + sheet close
    closed = page.get_by_test_id("report-sheet").count() == 0
    check(closed, f"({phase}) sheet closes after Done")
    return closed


def main():
    from playwright.sync_api import sync_playwright

    make_fixtures()
    fixture1_bytes = open(FIXTURE_1, "rb").read()
    fixture2_bytes = open(FIXTURE_2, "rb").read()

    # Threaded: the delayed stub holds one connection 5s; other requests
    # (favicon, HMR) must not block behind it.
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler)
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
        page.add_init_script(INIT_SCRIPT)

        print("Loading app...")
        page.goto(BASE, wait_until=LOAD_WAIT)
        page.wait_for_timeout(3000)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)

        # The hooks install at import time, but the DB may not be ready yet
        # (notably under the slower dev bundler) — retry seeding until it lands.
        print("Seeding (waiting for DB)...")
        seeded = False
        for _ in range(30):
            try:
                page.evaluate("""() => {
                    window.__nurtureTest.completeOnboarding();
                    window.__nurtureTest.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
                }""")
                seeded = True
                break
            except Exception:
                page.wait_for_timeout(2000)
        if not seeded:
            print("  FAIL: seeding never succeeded (DB never became ready)")
            raise SystemExit(1)
        page.wait_for_timeout(500)

        # ---- phase 1: success path (delayed stub → interim state is observable)
        print("Phase 1: ephemeral success path")
        stub_state["mode"] = "delayed-success"
        # domcontentloaded (not networkidle): the stub holds the summary
        # response 5s to keep "Summarizing your report…" observable — a
        # networkidle wait would sit out the hold and the test would miss it.
        page.goto(LOGS, wait_until="domcontentloaded")
        page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        # The testhooks-gated transport reads location.search at invoke
        # time — if the router dropped the query, the app would degrade to
        # "not configured" and every assertion below would mislead.
        check("testhooks=1" in page.url, "(a) testhooks query survives navigation")

        if not add_report_via_ui(page, check, FIXTURE_1, "a"):
            print("  FAIL: phase 1 UI flow broke; skipping remaining phase-1 checks")
        else:
            # (a) interim: "Summarizing your report…" while the stub holds.
            # Atomic poll: wait until the indicator exists AND carries the
            # text — a separate wait_for + inner_text races the unmount
            # when the stub hold ends (the indicator unmounts as the card
            # lands).
            try:
                page.wait_for_function(
                    "() => { const el = document.querySelector('[data-testid=\"report-summary-loading\"]'); "
                    "return !!el && (el.textContent || '').includes('Summarizing your report'); }",
                    timeout=10000)
                check(True, "(a) 'Summarizing your report…' shown while in flight")
            except Exception:
                check(False, "(a) 'Summarizing your report…' shown while in flight")

            # (a) success → text-only summary card.
            card = page.locator('[data-testid="report-summary-card"]')
            try:
                card.first.wait_for(state="visible", timeout=20000)
                check(True, "(a) summary card renders")
            except Exception:
                check(False, "(a) summary card renders")
            if card.count():
                title = page.get_by_test_id("report-summary-title").first.inner_text()
                check(title == "Growth scan", "(a) short title renders")
                body = card.first.inner_text()
                check("typical for this stage" in body, "(a) plain-language body renders")
                check("This isn't medical advice." in body,
                      "(a) locked disclaimer renders (never model-written)")
                check("willow-test-report.pdf" not in body,
                      "(a) raw filename NOT shown on the entry")
                check("Backing up" not in body, "(a) no 'Backing up…' on the entry")
            check(page.locator('[data-testid="report-summary-open"]').count() == 0,
                  "(a) no Open button (no attachment card)")
            check(page.get_by_text("Report", exact=True).count() > 0,
                  "(a) Report chip/label on the entry")

            # (a) the ephemeral invoke contract: EXACTLY {dataBase64, mimeType}.
            check(len(seen_requests) > 0, "(a) edge function was invoked")
            if seen_requests:
                req_body = seen_requests[0]
                check(sorted(req_body.keys()) == ["dataBase64", "mimeType"],
                      "(a) request body carries ONLY {dataBase64, mimeType}")
                check(req_body.get("mimeType") == "application/pdf",
                      "(a) mimeType is application/pdf")
                try:
                    decoded = base64.b64decode(req_body.get("dataBase64", ""))
                except Exception:
                    decoded = None
                check(decoded == fixture1_bytes,
                      "(a) dataBase64 decodes to the picked fixture bytes")

        # ---- phase 2: failure → fallback card + Try again (NO reload:
        # the bytes are memory-only, and this phase proves the same-session
        # retry path works)
        print("Phase 2: failure + Try again (no reload)")
        stub_state["mode"] = "failure"
        if not add_report_via_ui(page, check, FIXTURE_2, "b"):
            print("  FAIL: phase 2 UI flow broke; skipping remaining phase-2 checks")
        else:
            failed_card = page.locator('[data-testid="report-summary-failed"]')
            try:
                failed_card.first.wait_for(state="visible", timeout=20000)
                check(True, "(b) fallback card renders on failure")
            except Exception:
                check(False, "(b) fallback card renders on failure")
            if failed_card.count():
                check("Couldn't read this one \u2014 try a clearer photo." in failed_card.first.inner_text(),
                      "(b) \"Couldn't read this one\" message")
                check("Backing up" not in failed_card.first.inner_text(),
                      "(b) no 'Backing up…' on the failed entry")
            retry = failed_card.locator('[data-testid="report-summary-retry"]')
            check(retry.count() > 0, "(b) Try again action present")

            # ---- phase 3: Try again recovers once the stub succeeds
            print("Phase 3: Try again recovers")
            stub_state["mode"] = "success"
            if retry.count() > 0:
                retry.first.click()
                try:
                    page.wait_for_function(
                        "() => document.querySelectorAll('[data-testid=\"report-summary-card\"]').length >= 2",
                        timeout=20000,
                    )
                    check(True, "(c) Try again recovers → second summary card renders")
                except Exception:
                    check(False, "(c) Try again recovers → second summary card renders")
                cards = page.locator('[data-testid="report-summary-card"]')
                if cards.count() >= 2:
                    check("Growth scan" in cards.nth(1).inner_text(),
                          "(c) retried card carries the summary title")
                # The retry re-sent the SECOND fixture's bytes, inline.
                if len(seen_requests) >= 3:
                    retry_body = seen_requests[2]
                    check(sorted(retry_body.keys()) == ["dataBase64", "mimeType"],
                          "(c) retry body is also ONLY {dataBase64, mimeType}")
                    try:
                        retry_decoded = base64.b64decode(retry_body.get("dataBase64", ""))
                    except Exception:
                        retry_decoded = None
                    check(retry_decoded == fixture2_bytes,
                          "(c) retry re-sends the second fixture's bytes")
                else:
                    check(False, "(c) retry invoked the function again")
            else:
                check(False, "(c) Try again recovers (no retry button)")

        # ---- page errors ----
        check(len(errors) == 0, f"(d) zero page errors ({len(errors)} seen)")
        for e in errors[:5]:
            print(f"    pageerror: {e}")

        browser.close()

    print(f"\nreport_summary interactive: {passed} passed, {failed} failed")
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
