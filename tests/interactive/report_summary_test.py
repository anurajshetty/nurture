#!/usr/bin/env python3
"""
Report-summary interactive test: the Report timeline entry's
"Reading your report…" → summary card → failure/try-again flow in real
Chromium against the web export served under /willow/ (with ?testhooks=1).

`functions.invoke` is stubbed AT THE NETWORK LAYER: the app still
crosses a real fetch boundary (via the testhooks-gated transport in
src/reportSummary/client.ts), and Playwright intercepts the HTTP call to
the edge-function URL. No real Supabase or Gemini traffic.

Covers:
  (a) success → summary card renders with Report chip/title/body,
      LLM-derived attachment name, Open ›, and the fixed disclaimer;
      the invoke body carries ONLY {eventId, bucket, storagePath, mimeType}
  (b) failure → "Couldn't read this one" card + Try again recovers on retry
  (c) "Reading your report…" appears while the request is in flight
  (d) zero page errors throughout

Run: python3 tests/interactive/report_summary_test.py
"""

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
# (which would stomp the shared dist/). The proxy intercepts
# /sql-wasm-browser.wasm and serves the real bytes with the correct
# MIME type (Metro dev serves it as text/html, which breaks expo-sqlite
# on web). Everything else is forwarded to the dev server.
PROXY_DEV = os.environ.get("RS_PROXY_DEV") == "1"
DEV_TARGET = os.environ.get("RS_DEV_TARGET", "http://localhost:8083")
WASM_FILE = os.path.expanduser(
    "~/workspace/nurture-v12/node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm"
)
BASE = os.environ.get("RS_BASE", f"http://localhost:{PORT}/willow/?testhooks=1")
LOGS = os.environ.get("RS_LOGS", f"http://localhost:{PORT}/willow/logs?testhooks=1")
# Dev HMR keeps a websocket open, so networkidle never fires there.
LOAD_WAIT = "domcontentloaded" if PROXY_DEV else "networkidle"

STUB_URL_PATH = "/functions/v1/report-summary"

SUMMARY_200 = {
    "title": "Growth scan",
    "summary": "Your growth scan looks typical for this stage — a routine check your care team is already watching.",
    "attachmentName": "Growth scan – Sep 19",
    "needsAttention": False,
    "disclaimer": "This isn't medical advice — check with your care team.",
}

# Mutable stub behavior, flipped by the test between phases.
stub_state = {"mode": "delayed-success"}
seen_requests = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def proxy_dev(self):
        """Reverse-proxy to the Metro dev server, fixing the wasm MIME type."""
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
            rel = path[len("/willow/"):]
        elif path == "/willow":
            rel = ""
        else:
            rel = path.lstrip("/")
        target = DEV_TARGET + "/" + rel + query
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


# The test transport: installed before the app boots so the app's
# functions.invoke path still performs a REAL fetch — which Playwright
# intercepts below at the network layer.
INIT_SCRIPT = """
window.__reportSummaryTestTransport = {
  invoke: async (body) => {
    const res = await fetch('https://report-summary-stub.local/functions/v1/report-summary', {
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


def seed_report(page, att_id, filename, storage_path):
    page.evaluate(
        """([attId, filename, storagePath]) => {
            window.__nurtureTest.seedEvent({
              type: 'report',
              data: {
                text: filename,
                category: 'report',
                attachments: [{
                  id: attId,
                  kind: 'file',
                  name: filename,
                  mimeType: 'application/pdf',
                  upload: 'done',
                  storage_path: storagePath,
                }],
              },
              visibility: 'private',
            });
        }""",
        [att_id, filename, storage_path],
    )


def main():
    from playwright.sync_api import sync_playwright

    # In proxy-dev mode the test server below is the reverse proxy; in
    # dist mode it serves the export. Either way the test itself is the
    # same — BASE/LOGS just point at the server.
    # allow_reuse_address: repeated runs leave the port in TIME_WAIT;
    # without this the bind fails with "Address already in use".
    socketserver.TCPServer.allow_reuse_address = True
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

    def handle_stub(route):
        mode = stub_state["mode"]
        try:
            seen_requests.append(json.loads(route.request.post_data or "{}"))
        except Exception:
            seen_requests.append(None)
        if mode == "failure":
            route.fulfill(status=500, content_type="application/json", body='{"error":"boom"}')
        elif mode == "delayed-success":
            # Hold the request so "Reading your report…" stays observable
            # while the test navigates and locates it.
            time.sleep(4)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(SUMMARY_200))
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(SUMMARY_200))

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser(
                "~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"),
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(INIT_SCRIPT)
        page.route(f"**{STUB_URL_PATH}", handle_stub)

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

        # ---- phase 1: success path (delayed stub → loading state is observable)
        print("Phase 1: success path")
        stub_state["mode"] = "delayed-success"
        seed_report(page, "att-1", "scan.pdf", "reports/att-1.pdf")
        # domcontentloaded (not networkidle): the stub holds the summary
        # response 4s to keep "Reading your report…" observable — a
        # networkidle wait would sit out the hold and the test would miss it.
        page.goto(LOGS, wait_until="domcontentloaded")
        page.locator('[data-testid="timeline-list"]').first.wait_for(state="visible", timeout=15000)

        # (c) "Reading your report…" appears while the request is in flight
        # (the stub holds the response 4s so the loading state is observable).
        # Atomic poll: wait until the indicator exists AND carries the text.
        # A separate wait_for + inner_text races the unmount when the 4s
        # stub hold ends (the indicator unmounts when the card lands).
        try:
            page.wait_for_function(
                "() => { const el = document.querySelector('[data-testid=\"report-summary-loading\"]'); "
                "return !!el && (el.textContent || '').includes('Reading your report'); }",
                timeout=10000)
            check(True, "(c) 'Reading your report…' shown while in flight")
            check(True, "(c) loading text is 'Reading your report…'")
        except Exception:
            check(False, "(c) 'Reading your report…' shown while in flight")
            check(False, "(c) loading text is 'Reading your report…'")

        # (a) success → summary card
        card = page.locator('[data-testid="report-summary-card"]')
        try:
            card.first.wait_for(state="visible", timeout=15000)
            check(True, "(a) summary card renders")
        except Exception:
            check(False, "(a) summary card renders")
        if card.count():
            text = card.first.inner_text()
            check("Growth scan" in text, "(a) serif title renders")
            check("typical for this stage" in text, "(a) summary body renders")
            check("Growth scan – Sep 19" in text, "(a) LLM-derived attachment name renders")
            check("Auto-named from your report" in text, "(a) auto-named caption renders")
            check("This isn't medical advice \u2014 check with your care team." in text,
                  "(a) fixed disclaimer renders (never model-written)")
        open_btn = page.locator('[data-testid="report-summary-open"]')
        check(open_btn.count() > 0, "(a) Open › affordance present")
        if open_btn.count():
            check("Open" in open_btn.first.inner_text(), "(a) Open › label")
        # Report chip: the entry header carries the Report type label
        check(page.get_by_text("Report", exact=True).count() > 0, "(a) Report chip/label on the entry")

        # the invoke body carries ONLY the four storage-pointer fields
        check(len(seen_requests) > 0, "(a) edge function was invoked")
        if seen_requests:
            body = seen_requests[0]
            check(sorted(body.keys()) == ["bucket", "eventId", "mimeType", "storagePath"],
                  "(a) request body carries only {eventId, bucket, storagePath, mimeType}")
            check(body.get("bucket") == "files", "(a) bucket allowlisted ('files')")
            check(body.get("storagePath") == "reports/att-1.pdf", "(a) storagePath passed through")
            check(body.get("mimeType") == "application/pdf", "(a) mimeType passed through")
            check(isinstance(body.get("eventId"), str) and len(body["eventId"]) > 0,
                  "(a) eventId present")

        # ---- phase 2: failure → fallback card + Try again recovers
        print("Phase 2: failure + Try again")
        stub_state["mode"] = "failure"
        seed_report(page, "att-2", "report2.pdf", "reports/att-2.pdf")
        page.goto(LOGS, wait_until=LOAD_WAIT)  # reboot via goto (never reload), per harness notes
        page.wait_for_timeout(2500)

        failed_card = page.locator('[data-testid="report-summary-failed"]')
        try:
            failed_card.first.wait_for(state="visible", timeout=15000)
            check(True, "(b) fallback card renders on failure")
        except Exception:
            check(False, "(b) fallback card renders on failure")
        if failed_card.count():
            check("Couldn't read this one \u2014 try a clearer photo." in failed_card.first.inner_text(),
                  "(b) 'Couldn\\'t read this one' message")
        retry = failed_card.locator('[data-testid="report-summary-retry"]')
        check(retry.count() > 0, "(b) Try again action present")
        # the original attachment is preserved and openable in the failed state
        failed_open = failed_card.locator('[data-testid="report-summary-open"]')
        check(failed_open.count() > 0, "(b) original attachment still openable after failure")
        if failed_open.count():
            check("report2.pdf" in failed_card.first.inner_text(),
                  "(b) raw filename preserved in failed state")

        # Try again recovers once the stub succeeds
        stub_state["mode"] = "success"
        if retry.count() > 0:
            retry.first.click()
            try:
                page.wait_for_function(
                    "() => document.querySelectorAll('[data-testid=\"report-summary-card\"]').length >= 2",
                    timeout=15000,
                )
                check(True, "(b) Try again recovers → summary card renders")
            except Exception:
                check(False, "(b) Try again recovers → summary card renders")
        else:
            check(False, "(b) Try again recovers → summary card renders (no retry button)")

        # ---- page errors ----
        check(len(errors) == 0, f"(d) zero page errors ({len(errors)} seen)")
        for e in errors[:5]:
            print(f"    pageerror: {e}")

        browser.close()

    print(f"\nreport_summary interactive: {passed} passed, {failed} failed")
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
