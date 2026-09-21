#!/usr/bin/env python3
"""Standing interactive browser test: partner sharing (mockup 33 rev C).

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/. Covers:

  1. journal sheet -> visibility picker (Private/Shared/+Export) with the
     plain-language note updating per state (via the journal-test route)
  2. You tab -> "Share with your partner" row opens the partners-list sheet
  3. partners list: "Your partners" header, named-invite rows only,
     "Add a partner" asks "Who is this code for?" — no system Share button;
     graceful degradation when the backend migration isn't applied
     (never a crash)
  4. no reachable old partner UI: no one-partner footer, no single big
     code card, no system Share, no 24h expiry, no nurture.app/join links,
     no owner-confirm gate
  5. role-split welcome carries no "One partner per account, for now."
Zero page errors allowed.

Run:  python3 tests/interactive/epic7_partner_browser_test.py [--keep-open]
"""

import mimetypes
import os
import sys
import json

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
JOURNAL_TEST = ORIGIN + "/willow/journal-test?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

SEED_JS = r"""
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  // One shared keepsake moment (visible to the partner) ...
  t.seedEvent({ type: "milestone", occurredAt: iso(4), visibility: "shared",
    data: { text: "First strong kicks — felt them during dinner." } });
  // ... and one private health log (never visible to the partner).
  t.seedEvent({ type: "symptom", occurredAt: iso(1),
    data: { symptoms: ["Heartburn", "Backache"] } });
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
        # SPA fallback: expo-router tab routes have no static file.
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
        def supabase_stub(route):
            # The backend isn't reachable from the test sandbox; answer API
            # calls with a clean JSON error so no "Failed to load resource"
            # console error is logged. The app degrades gracefully.
            route.fulfill(
                status=404,
                content_type="application/json",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Expose-Headers": "Content-Range",
                },
                body='{"code":"42883","message":"function does not exist"}',
            )

        ctx.route("https://*.supabase.co/**", supabase_stub)
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))

        def _note_console(m):
            # "Failed to load resource" is network outcome (the backend
            # migration isn't applied / the sandbox blocks the API host) —
            # never a JS bug. Uncaught exceptions arrive via pageerror.
            if m.type == "error" and not (m.text or "").startswith("Failed to load resource"):
                page_errors.append(m.text[:200])

        page.on("console", _note_console)

        # ---- Flow 1: visibility picker on the journal sheet ----
        page.goto(JOURNAL_TEST, timeout=30000)
        page.get_by_test_id("journal-test-open").click()
        sheet = page.get_by_test_id("journal-sheet")
        try:
            sheet.wait_for(timeout=15000)
        except Exception:
            check("flow1: journal sheet opens", False, "journal-sheet never appeared")
            browser.close()
            sys.exit(1)
        check("flow1: journal sheet opens", True)

        picker = page.get_by_test_id("journal-visibility")
        check("flow1: visibility picker present", picker.count() == 1)
        note = page.get_by_test_id("journal-visibility-note")
        note_text = note.inner_text()
        check("flow1: default note is the private note",
              "only you" in note_text and "Alex" in note_text, f"note={note_text!r}")

        page.get_by_role("radio", name="👥 Shared").click()
        page.wait_for_timeout(400)
        note_text = note.inner_text()
        check("flow1: shared note explains visit summaries",
              "Shared" in note_text and "visit summaries" in note_text, f"note={note_text!r}")

        page.get_by_role("radio", name="📄 + Export").click()
        page.wait_for_timeout(400)
        note_text = note.inner_text()
        check("flow1: +export note mentions visit summary",
              "visit summary" in note_text, f"note={note_text!r}")

        # Save a note with the +Export visibility; the sheet must close cleanly.
        page.get_by_test_id("journal-text-input").fill("Bump photo day — feeling great.")
        page.get_by_role("radio", name="🔒 Private").click()
        page.wait_for_timeout(300)
        page.get_by_test_id("journal-voice").click()  # send arrow: text present -> saves
        try:
            sheet.wait_for(state="detached", timeout=8000)
            check("flow1: saving closes the sheet", True)
        except Exception:
            check("flow1: saving closes the sheet", False, "sheet stayed open")

        # ---- Flows 2-5: partner section in the You tab ----
        page.goto(BASE, timeout=30000)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        # Fresh context: onboarding isn't done, so complete it via hooks
        # before expecting the tab shell.
        page.evaluate("window.__nurtureTest.completeOnboarding()")
        # The week screen needs a pregnancy row — without one it renders a
        # testID-less empty variant. Seed both, then reload.
        page.evaluate("window.__nurtureTest.seedPregnancy({ dueDate: '2026-12-31' })")
        # The sql.js DB persists to localStorage asynchronously — give the
        # writes a beat before reloading, or they are lost on navigation.
        page.wait_for_timeout(2000)
        page.goto(BASE, timeout=30000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
        except Exception:
            check("app boots to Week", False, "week-screen never appeared")
            browser.close()
            sys.exit(1)
        seed_status = page.evaluate(SEED_JS)
        check("test hooks active and seeded", seed_status == "seeded", f"status={seed_status}")

        page.get_by_role("tab", name="You").click()
        row = page.get_by_test_id("partner-sharing-row")
        try:
            row.wait_for(timeout=15000)
        except Exception:
            check("flow2: partner row present in You tab", False, "row never appeared")
            browser.close()
            sys.exit(1)
        check("flow2: partner row present in You tab", True)
        check("flow2: row reads Share with your partner",
              "Share with your partner" in row.inner_text(), f"row={row.inner_text()[:80]!r}")

        row.click()
        psheet = page.get_by_test_id("partner-sheet")
        try:
            psheet.wait_for(timeout=10000)
        except Exception:
            check("flow2: partners-list sheet opens", False, "partner-sheet never appeared")
            browser.close()
            sys.exit(1)
        check("flow2: partners-list sheet opens", True)
        body = psheet.inner_text()
        check("flow2: Your partners header",
              "Your partners" in body, f"body={body[:120]!r}")

        # ---- Flow 3: partners-list contract + graceful degradation ----
        check("flow3: backend-not-ready note shown, no crash",
              "getting ready" in body, f"body={body[:160]!r}")
        # No single big code card on the named-invite surface.
        check("flow3: no single-code card",
              page.get_by_test_id("share-code-value").count() == 0,
              "old one-code surface still present")
        # No system Share button anywhere — Copy is the only handoff.
        check("flow3: no system Share button",
              page.get_by_test_id("share-code-share").count() == 0,
              "Share button still present")
        # No Add button while the backend isn't ready; no phantom rows.
        check("flow3: Add hidden without backend",
              page.get_by_test_id("partners-list-add").count() == 0,
              "Add visible with no backend")
        check("flow3: no unnamed invite rows",
              "Invited" not in body, f"body={body[:160]!r}")

        # ---- Flow 4: no reachable old partner UI ----
        for old in ("One partner per account", "Your invite code", "expires in",
                    "24h", "Confirm & start sharing", "accepted your invite",
                    "nurture.app/join/", "Partner\u2019s view"):
            check("flow4: no old UI " + old[:24], old not in body, "old copy leaked: " + old)

        # ---- Flow 5: close the sheet; row subtitle stays sane ----
        page.get_by_test_id("partners-list-back").click()
        page.wait_for_timeout(1200)
        check("flow5: sheet closes via back",
              page.get_by_test_id("partner-sheet").count() == 0, "sheet stayed open")
        row_text = page.get_by_test_id("partner-sharing-row").inner_text()
        check("flow5: row subtitle is the not-ready reading",
              "None yet" in row_text or "Partner sharing" in row_text,
              f"row={row_text[:80]!r}")

        check("zero page errors", len(page_errors) == 0,
              f"errors={page_errors[:3]}" if page_errors else "")

        # ---- Flow 6: the named add flow with a working backend stub ----
        # Stateful stub: create mints a named pending invite; the list
        # reads them back; revoke drops them. Exercises "Who is this code
        # for?" -> code reveal + Copy -> pending row -> 5-max note.
        created = []

        def positive_stub(route):
            url = route.request.url
            posted = route.request.post_data or ""
            try:
                payload = json.loads(posted) if posted else {}
            except Exception:
                payload = {}

            def fulfill(status, body):
                return route.fulfill(
                    status=status,
                    content_type="application/json",
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Expose-Headers": "Content-Range",
                    },
                    body=body,
                )

            if "/rpc/create_partner_invite" in url:
                name = str(payload.get("p_name", "")).strip()
                if not name:
                    return fulfill(400, '{"code":"P0001","message":"name_required"}')
                live = [c for c in created if c["status"] in ("pending", "accepted")]
                if len(live) >= 5:
                    return fulfill(400, '{"code":"P0001","message":"max_partners_reached"}')
                created.append({
                    "invite_id": f"id-{len(created)}",
                    "partner_name": name[:30],
                    "status": "pending",
                })
                return fulfill(200, '[{"code":"K7X2QM"}]')
            if "/rpc/my_partner_invites" in url:
                rows = [
                    {"invite_id": c["invite_id"], "partner_name": c["partner_name"], "status": c["status"]}
                    for c in created
                ]
                return fulfill(200, json.dumps(rows))
            if "/rpc/revoke_partner" in url:
                iid = str(payload.get("p_invite_id", ""))
                for c in created:
                    if c["invite_id"] == iid:
                        created.remove(c)
                        return fulfill(200, "null")
                return fulfill(400, '{"code":"P0001","message":"no_partner_link"}')
            return fulfill(404, '{"code":"42883","message":"function does not exist"}')

        ctx.unroute("https://*.supabase.co/**")
        ctx.route("https://*.supabase.co/**", positive_stub)
        page.goto(BASE, timeout=30000)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page.evaluate("window.__nurtureTest.completeOnboarding()")
        page.evaluate("window.__nurtureTest.seedPregnancy({ dueDate: '2026-12-31' })")
        page.wait_for_timeout(2000)
        page.goto(BASE, timeout=30000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
        except Exception:
            check("flow6: app reboots to Week", False, "week-screen never appeared")
            browser.close()
            sys.exit(1)

        page.get_by_role("tab", name="You").click()
        row = page.get_by_test_id("partner-sharing-row")
        row.wait_for(timeout=15000)
        check("flow6: count starts at None yet", "None yet" in row.inner_text(),
              f"row={row.inner_text()[:80]!r}")
        row.click()
        psheet = page.get_by_test_id("partner-sheet")
        psheet.wait_for(timeout=10000)
        check("flow6: empty list invites adding",
              "each gets a personal code" in psheet.inner_text(),
              f"body={psheet.inner_text()[:120]!r}")
        add_btn = page.get_by_test_id("partners-list-add")
        check("flow6: Add a partner visible", add_btn.count() == 1)
        add_btn.click()
        check("flow6: add asks who the code is for",
              "who is this code for?" in psheet.inner_text().lower())
        create_btn = page.get_by_test_id("partner-add-create")
        check("flow6: Create code quiet until a name is given",
              create_btn.get_attribute("aria-disabled") == "true")
        page.get_by_test_id("partner-add-name").fill("Sam")
        page.wait_for_timeout(300)
        check("flow6: Create code enables with a name",
              create_btn.get_attribute("aria-disabled") != "true")
        create_btn.click()
        page.get_by_test_id("partner-new-code").wait_for(timeout=10000)
        newcode = page.get_by_test_id("partner-new-code")
        check("flow6: 6-char code reveals for the named invite",
              "K7X2QM" in newcode.inner_text() and "Sam" in newcode.inner_text(),
              f"newcode={newcode.inner_text()[:80]!r}")
        check("flow6: Copy is the only handoff on the reveal",
              page.get_by_test_id("partner-new-code-copy").count() == 1
              and page.get_by_test_id("share-code-share").count() == 0)
        check("flow6: pending row reads Name · Invited",
              "Sam" in psheet.inner_text() and "· Invited" in psheet.inner_text(),
              f"body={psheet.inner_text()[:200]!r}")
        # Pending rows have no remove action.
        check("flow6: pending row has no remove button",
              page.get_by_test_id("partner-row-remove-id-0").count() == 0)
        check("flow6: shared-only note present",
              "They see only the moments you mark as shared." in psheet.inner_text())
        check("flow6: count reads 1 of 5",
              "1 of 5" in page.get_by_test_id("partners-list-count").inner_text())

        # Fill to 5/5: the Add button gives way to the warm max note.
        for nm in ("Maya", "Noah", "Priya", "Zoe"):
            page.get_by_test_id("partners-list-add").click()
            page.get_by_test_id("partner-add-name").fill(nm)
            page.wait_for_timeout(200)
            page.get_by_test_id("partner-add-create").click()
            page.get_by_test_id("partner-new-code").wait_for(timeout=10000)
            page.wait_for_timeout(300)
        check("flow6: count reads 5 of 5",
              "5 of 5" in page.get_by_test_id("partners-list-count").inner_text())
        check("flow6: Add hidden at 5 of 5",
              page.get_by_test_id("partners-list-add").count() == 0)
        maxnote = page.get_by_test_id("partners-list-max")
        check("flow6: warm max note at 5 of 5",
              maxnote.count() == 1 and "the most Willow allows right now" in maxnote.inner_text(),
              f"max={maxnote.inner_text()[:90]!r}" if maxnote.count() else "missing")
        check("zero page errors after named flows", len(page_errors) == 0,
              f"errors={page_errors[:3]}" if page_errors else "")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open)")
            page.wait_for_timeout(3600_000)
        browser.close()

    print(f"\n=== epic7 browser: {len(failures)} failures; {len(page_errors)} page errors ===")
    if failures or page_errors:
        sys.exit(1)
    print("ALL GREEN")


if __name__ == "__main__":
    main()
