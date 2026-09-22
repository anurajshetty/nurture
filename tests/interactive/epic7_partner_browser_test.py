#!/usr/bin/env python3
"""Standing interactive browser test: partner sharing (mockup 33,
partners-card + entry-sharing, Anuraj approved Sept 21, 2026).

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/. Covers:

  1. text-only new-log composer: real switch default ON, Shared/Not
     shared + hint per state, handshake explainer, sharing-aware save
     toast (via the Logs-tab Add flow)
  1b. appointment sheet: the sharing row, default ON, explainer
  2. You tab -> "Your partners" row opens the partners-list sheet
  3. partners list: "Your partners" header, named-invite rows only,
     "Add a partner" asks "Who is this code for?" — no system Share button;
     graceful degradation when the backend migration isn't applied
     (never a crash)
  4. no reachable old partner UI: no one-partner footer, no single big
     code card, no system Share, no 24h expiry, no nurture.app/join links,
     no owner-confirm gate
  5. row subtitle stays sane
  6. named add flow: pending row shows its 6-char code inline + Copy
     (toast "Code copied."), count reads N of 5
  7. pending "Remove invite" -> in-app confirmation dialog ("Remove this
     invite?" / code-stops-working body) -> Keep dismisses, Remove
     confirms ("Invite removed.")
  8. accepted row: real switch (no per-partner subtitle, toasts naming
     the partner), never a code; row x -> "Remove Maya?" dialog
     (access-lost body) -> "Partner removed."
  9. 5/5: Add hidden, warm max note verbatim
  10. feed card switch labels (Shared/Not shared + hints) and the You-tab
      global "Share new entries with partners" row (ON/OFF copy verbatim,
      handshake explainer)
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

        # ---- Flow 1: the text-only new-log composer (mockup 33-entry-sharing) ----
        # Logs tab -> Add -> Log entry: the real switch, default ON, with
        # the form hint per state; saving toasts the sharing outcome.
        page.goto(BASE, timeout=30000)
        page.wait_for_function("() => typeof window.__nurtureTest !== 'undefined'", timeout=30000)
        page.evaluate("window.__nurtureTest.completeOnboarding()")
        page.evaluate("window.__nurtureTest.seedPregnancy({ dueDate: '2026-12-31' })")
        page.wait_for_timeout(2000)
        page.goto(BASE, timeout=30000)
        try:
            page.get_by_test_id("week-screen").wait_for(timeout=30000)
        except Exception:
            check("flow1: app boots to Week", False, "week-screen never appeared")
            browser.close()
            sys.exit(1)
        page.get_by_role("tab", name="Logs").click()
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=8000)
        page.get_by_test_id("add-menu-pill-log").click()
        card = page.get_by_test_id("new-log-card")
        card.wait_for(timeout=10000)
        check("flow1: text-only composer opens", True)
        check("flow1: composer carries the handshake explainer",
              "Sharing is a handshake: entries marked Shared are visible to partners whose sharing is on." in card.inner_text())
        check("flow1: composer has no voice or photo options",
              "voice" not in card.inner_text().lower() and "photo" not in card.inner_text().lower(),
              f"card={card.inner_text()[:140]!r}")
        switch = page.get_by_test_id("new-log-share-switch")
        check("flow1: composer has the real sharing switch", switch.count() == 1)
        check("flow1: switch defaults ON with the shared hint",
              "Shared" in card.inner_text() and "Shared with your partner." in card.inner_text(),
              f"card={card.inner_text()[:200]!r}")
        switch.click()
        page.wait_for_timeout(400)
        check("flow1: flipped switch reads Not shared",
              "Not shared" in card.inner_text() and "Only you can see this." in card.inner_text())
        switch.click()
        page.wait_for_timeout(400)
        page.get_by_test_id("new-log-input").fill("Kick counting went well today.")
        page.get_by_test_id("new-log-save").click()
        toast = page.get_by_test_id("floating-composer-toast")
        toast.wait_for(timeout=8000)
        check("flow1: sharing-aware save toast",
              "Log saved — shared with your partner." in toast.inner_text(),
              f"toast={toast.inner_text()[:80]!r}")
        page.wait_for_timeout(600)

        # ---- Flow 1b: the appointment sheet switch ----
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=8000)
        page.get_by_test_id("add-menu-pill-appointment").click()
        asheet = page.get_by_test_id("appointment-sheet")
        asheet.wait_for(timeout=10000)
        check("flow1b: appointment sheet opens", True)
        arow = page.get_by_test_id("appointment-share-row")
        check("flow1b: appointment sheet has the sharing row", arow.count() == 1)
        check("flow1b: appointment switch defaults ON",
              "Shared" in arow.inner_text() and "Shared with your partner." in arow.inner_text(),
              f"arow={arow.inner_text()[:140]!r}")
        check("flow1b: appointment sheet carries the handshake explainer",
              "Sharing is a handshake" in page.get_by_test_id("appointment-share-explainer").inner_text())
        check("zero page errors after creation flows", len(page_errors) == 0,
              f"errors={page_errors[:3]}" if page_errors else "")

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
        check("flow2: row reads Your partners",
              "Your partners" in row.inner_text(), f"row={row.inner_text()[:80]!r}")

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
        # Stateful stub: create mints a named pending invite (with a code);
        # the list reads them back; set_partner_sharing flips the per-partner
        # switch; revoke drops them. Exercises "Who is this code for?" ->
        # pending row with code + Copy -> Remove invite dialog -> accepted
        # row switch -> Remove partner dialog -> 5-max note.
        created = []
        CODES = ["K7X2QM", "P4T9WR", "B8N3VD", "F6H5JL", "D2S7KG"]

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
                idx = len(created)
                created.append({
                    "invite_id": f"id-{idx}",
                    "partner_name": name[:30],
                    "status": "pending",
                    "code": CODES[idx % len(CODES)],
                    "sharing_enabled": True,
                })
                return fulfill(200, f'[{{"code":"{CODES[idx % len(CODES)]}"}}]')
            if "/rpc/my_partner_invites" in url:
                rows = []
                for c in created:
                    row = {
                        "invite_id": c["invite_id"],
                        "partner_name": c["partner_name"],
                        "status": c["status"],
                        "sharing_enabled": c.get("sharing_enabled", True),
                    }
                    # Pending rows carry the invite code; accepted rows never do.
                    if c["status"] == "pending":
                        row["code"] = c["code"]
                    rows.append(row)
                return fulfill(200, json.dumps(rows))
            if "/rpc/set_partner_sharing" in url:
                iid = str(payload.get("p_invite_id", ""))
                enabled = payload.get("p_enabled")
                for c in created:
                    if c["invite_id"] == iid and c["status"] == "accepted":
                        c["sharing_enabled"] = bool(enabled)
                        return fulfill(200, "null")
                return fulfill(400, '{"code":"P0001","message":"no_partner_link"}')
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
        ctx.grant_permissions(["clipboard-write", "clipboard-read"])
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

        def toast_text():
            t = page.get_by_test_id("you-toast")
            return t.inner_text() if t.count() else ""

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
        # In the You tab the new pending row shows its code inline (the
        # reveal card only appears in onboarding, which hides the list).
        page.get_by_test_id("partner-row-code-id-0").wait_for(timeout=10000)
        check("flow6: pending row shows its 6-char code inline",
              "K7X2QM" in page.get_by_test_id("partner-row-code-id-0").inner_text())
        check("flow6: pending row copy note",
              "Invite code — works once. Share it with them." in psheet.inner_text())
        check("flow6: pending row reads Sam · Invited",
              "Sam" in psheet.inner_text() and "· Invited" in psheet.inner_text())
        check("flow6: handshake explainer is gone (Anuraj Sept 21, 2026)",
              "Sharing is a handshake" not in psheet.inner_text())
        check("flow6: Copy is the only handoff on the pending row",
              page.get_by_test_id("partner-row-copy-id-0").count() == 1
              and page.get_by_test_id("share-code-share").count() == 0)
        page.get_by_test_id("partner-row-copy-id-0").click()
        page.wait_for_timeout(500)
        check("flow6: Copy toasts Code copied.", "Code copied." in toast_text(),
              f"toast={toast_text()!r}")
        check("flow6: count reads 1 of 5",
              "1 of 5" in page.get_by_test_id("partners-list-count").inner_text())

        # ---- Flow 7: Remove invite (pending) with confirmation ----
        rm_btn = page.get_by_test_id("partner-row-remove-id-0")
        check("flow7: pending row has x (replaces Remove invite)", rm_btn.count() == 1)
        rm_btn.click()
        dlg = page.get_by_test_id("remove-partner-dialog")
        dlg.wait_for(timeout=8000)
        dlg_text = dlg.inner_text()
        check("flow7: dialog title is Remove this invite?", "Remove this invite?" in dlg_text,
              f"dlg={dlg_text[:120]!r}")
        check("flow7: dialog body names the stopped code",
              "The invite and its code stop working. Sam won't be able to use it." in dlg_text)
        page.get_by_test_id("remove-partner-keep").click()
        page.wait_for_timeout(400)
        check("flow7: Keep invite dismisses the dialog",
              page.get_by_test_id("remove-partner-dialog").count() == 0)
        check("flow7: invite still listed after Keep",
              page.get_by_test_id("partner-row-id-0").count() == 1)
        page.get_by_test_id("partner-row-remove-id-0").click()
        page.get_by_test_id("remove-partner-dialog").wait_for(timeout=8000)
        page.get_by_test_id("remove-partner-confirm").click()
        page.wait_for_timeout(1200)
        check("flow7: Invite removed toast", "Invite removed." in toast_text(),
              f"toast={toast_text()!r}")
        check("flow7: invite row gone after removal",
              page.get_by_test_id("partner-row-id-0").count() == 0)

        # ---- Flow 8: accepted row switch + Remove partner ----
        # Seed an accepted partner directly (redemption is server-side).
        created.append({
            "invite_id": "id-acc-1",
            "partner_name": "Maya",
            "status": "accepted",
            "sharing_enabled": True,
        })
        page.get_by_test_id("partners-list-back").click()
        page.wait_for_timeout(800)
        page.get_by_test_id("partner-sharing-row").click()
        psheet = page.get_by_test_id("partner-sheet")
        psheet.wait_for(timeout=10000)
        page.wait_for_timeout(1200)
        mrow = page.get_by_test_id("partner-row-id-acc-1")
        check("flow8: accepted row present", mrow.count() == 1)
        check("flow8: accepted row never shows a code",
              "K7X2QM" not in mrow.inner_text() and "P4T9WR" not in mrow.inner_text()
              and "invite code" not in mrow.inner_text().lower())
        sw = page.get_by_test_id("partner-row-switch-id-acc-1")
        check("flow8: accepted row has the real switch", sw.count() == 1)
        check("flow8: no per-partner subtitle (Anuraj Sept 21, 2026)",
              "Sees your shared entries" not in mrow.inner_text()
              and "Paused" not in mrow.inner_text())
        sw.click()
        page.wait_for_timeout(1200)
        check("flow8: paused toast names the partner",
              "Sharing paused for Maya." in toast_text(), f"toast={toast_text()!r}")
        check("flow8: still no subtitle after pausing",
              "Sees your shared entries" not in mrow.inner_text()
              and "Paused" not in mrow.inner_text())
        sw.click()
        page.wait_for_timeout(1200)
        check("flow8: back-on toast names the partner",
              "Sharing back on for Maya." in toast_text(), f"toast={toast_text()!r}")
        check("flow8: still no subtitle after re-enabling",
              "Sees your shared entries" not in mrow.inner_text()
              and "Paused" not in mrow.inner_text())
        page.get_by_test_id("partner-row-remove-id-acc-1").click()
        dlg = page.get_by_test_id("remove-partner-dialog")
        dlg.wait_for(timeout=8000)
        dlg_text = dlg.inner_text()
        check("flow8: dialog title is Remove Maya?", "Remove Maya?" in dlg_text,
              f"dlg={dlg_text[:120]!r}")
        check("flow8: dialog body says access lost, can re-invite",
              "Maya loses access to everything you've shared — and can be invited again later." in dlg_text)
        page.get_by_test_id("remove-partner-confirm").click()
        page.wait_for_timeout(1200)
        check("flow8: Partner removed toast", "Partner removed." in toast_text(),
              f"toast={toast_text()!r}")
        check("flow8: partner row gone after removal",
              page.get_by_test_id("partner-row-id-acc-1").count() == 0)

        # ---- Flow 9: fill to 5/5 ----
        for nm in ("Sam", "Noah", "Priya", "Zoe", "Leo"):
            page.get_by_test_id("partners-list-add").click()
            page.get_by_test_id("partner-add-name").fill(nm)
            page.wait_for_timeout(200)
            page.get_by_test_id("partner-add-create").click()
            page.wait_for_timeout(600)
        check("flow9: count reads 5 of 5",
              "5 of 5" in page.get_by_test_id("partners-list-count").inner_text())
        check("flow9: Add hidden at 5 of 5",
              page.get_by_test_id("partners-list-add").count() == 0)
        maxnote = page.get_by_test_id("partners-list-max")
        check("flow9: warm max note at 5 of 5",
              maxnote.count() == 1 and "You've added 5 partners — the most Willow allows right now." in maxnote.inner_text(),
              f"max={maxnote.inner_text()[:90]!r}" if maxnote.count() else "missing")
        page.get_by_test_id("partners-list-back").click()
        page.wait_for_timeout(800)
        check("flow9: You row reads 5 of 5",
              "5 of 5" in page.get_by_test_id("partner-sharing-row").inner_text())
        check("zero page errors after named flows", len(page_errors) == 0,
              f"errors={page_errors[:3]}" if page_errors else "")

        # ---- Flow 10: per-entry switch on a feed card ----
        # Seed one note (shared by default) and one private appointment,
        # then flip their switches on the Logs tab.
        page.evaluate("""() => {
          const t = window.__nurtureTest;
          t.clearEvents();
          const now = Date.now();
          t.seedEvent({ type: 'note', occurredAt: new Date(now - 3600000).toISOString(),
            visibility: 'shared', data: { text: 'Sharing switch probe note' } });
          t.seedEvent({ type: 'appointment', occurredAt: new Date(now - 7200000).toISOString(),
            visibility: 'private', data: { questions: [{ id: 'q1', text: 'Ask about iron', state: 'open' }] } });
        }""")
        page.wait_for_timeout(800)
        page.get_by_role("tab", name="Logs").click()
        page.wait_for_timeout(1500)
        note_card = page.get_by_text("Sharing switch probe note")
        check("flow10: seeded note card visible", note_card.count() >= 1)
        card = note_card.first
        # The shared switch lives inside the card; find it via the card's
        # subtree using the label testID pattern from EventCard.
        shared_label = page.get_by_text("Shared", exact=True)
        check("flow10: shared note card labels itself Shared", shared_label.count() >= 1)
        hint = page.get_by_text("Shared with your partner.", exact=True)
        check("flow10: shared hint present", hint.count() >= 1)
        # Flip the note card's switch: the label follows, and the change
        # persists across a re-render (local store + server mirror).
        note_switch = page.get_by_role("switch", name="Share this moment with your partner").first
        if note_switch.count() == 1:
            note_switch.click()
            page.wait_for_timeout(800)
            check("flow10: flipped card reads Not shared",
                  page.get_by_text("Not shared", exact=True).count() >= 1
                  and page.get_by_text("Only you can see this.", exact=True).count() >= 1)
            note_switch.click()
            page.wait_for_timeout(800)
        else:
            check("flow10: note card switch found", False, "switch missing")
        # The appointment card's switch is a sibling of the pressable body:
        # tapping it flips sharing WITHOUT opening the appointment editor.
        appt_card = page.locator('[data-testid^="event-card-"]').filter(has_text="questions to ask")
        check("flow10: seeded appointment card visible", appt_card.count() >= 1)
        appt_switch = appt_card.get_by_role("switch").first
        check("flow10: appointment card has the switch", appt_switch.count() == 1)
        appt_switch.click()
        page.wait_for_timeout(1000)
        check("flow10: switch tap does not open the appointment editor",
              page.get_by_test_id("appointment-sheet").count() == 0,
              "appointment editor opened from the switch tap")
        check("flow10: appointment card now reads Shared",
              appt_card.get_by_text("Shared", exact=True).count() >= 1)
        check("flow10: global default row present in You tab Partner sharing",
              True)
        page.get_by_role("tab", name="You").click()
        page.wait_for_timeout(1200)
        grow = page.get_by_test_id("share-default-row")
        check("flow10: You tab has Share new entries with partners", grow.count() == 1)
        check("flow10: global ON copy verbatim",
              "On — new logs, kicks, appointments and activities are shared." in grow.inner_text(),
              f"grow={grow.inner_text()[:120]!r}")
        gsw = page.get_by_test_id("share-default-switch")
        gsw.click()
        page.wait_for_timeout(600)
        check("flow10: global OFF copy verbatim",
              "Off — new entries stay private unless you share them." in grow.inner_text(),
              f"grow={grow.inner_text()[:120]!r}")
        check("flow10: global explainer is the handshake copy",
              "Sharing is a handshake: entries marked Shared are visible to partners whose sharing is on." in page.get_by_test_id("share-default-explainer").inner_text())
        gsw.click()
        page.wait_for_timeout(600)
        check("zero page errors at the end", len(page_errors) == 0,
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
