#!/usr/bin/env python3
"""
Interactive browser test: Epic 8 OB-visit export.

Drives the REAL Nurture web UI in real Chromium against the built dist/
served under /nurture/ (same pattern as timeline_browser_test.py). Events
are seeded through the app's own test hooks (?testhooks=1 ->
window.__nurtureTest.seedEvent, backed by the real SQLite store), so every
assertion below exercises the real range resolution, entry filtering,
summary building, and download handoff.

Run:  python3 tests/interactive/export_browser_test.py [--keep-open]

Flows:
  1. boot + seed -> You tab shows the "Export for OB visit" row
  2. export screen -> default "Since last visit" range (from the seeded
     past appointment); preview shows symptom frequency, weight trend,
     kick session, notes, questions; private note / photo / non-selected
     partner entry excluded; the +Export-marked partner note preselected
  3. facts-only -> preview carries "A user-entered record — not a clinical
     chart." + generated timestamp and no diagnosis/risk language
  4. toggles -> switching Symptoms off removes it from the preview;
     "Add" on Private notes adds the private note
  5. generate -> on web triggers a file download; the file contains the
     framing + facts-only content
  6. stopped -> after stopPregnancy, export still works (contract C3)
  7. zero page errors throughout
"""

import mimetypes
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/epic8-work")
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
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  t.seedEvent({ type: "symptom", visibility: "private", occurredAt: iso(2),
    data: { symptoms: ["Fatigue", "Heartburn"] } });
  t.seedEvent({ type: "symptom", visibility: "private", occurredAt: iso(5),
    data: { symptoms: ["Fatigue"] } });
  t.seedEvent({ type: "weight", visibility: "private", occurredAt: iso(6),
    data: { value: 139, unit: "lb" } });
  t.seedEvent({ type: "weight", visibility: "private", occurredAt: iso(1),
    data: { value: 142.5, unit: "lb" } });
  t.seedEvent({ type: "kick_session", visibility: "private", occurredAt: iso(3),
    data: { movements: 12, durationMin: 18 } });
  t.seedEvent({ type: "note", visibility: "shared", occurredAt: iso(1),
    data: { text: "Slept through the night for the first time in weeks." } });
  t.seedEvent({ type: "note", visibility: "private", occurredAt: iso(2),
    data: { text: "Private worry stays out by default." } });
  t.seedEvent({ type: "photo", visibility: "private", occurredAt: iso(4),
    data: { attachments: [{ id: "a1", kind: "photo", name: "bump.jpg",
                             upload: "pending" }] } });
  t.seedEvent({ type: "note", visibility: "export", occurredAt: iso(2),
    data: { text: "Partner note for the OB", author: "partner" } });
  t.seedEvent({ type: "note", visibility: "private", occurredAt: iso(3),
    data: { text: "Partner private note stays out", author: "partner" } });
  t.seedEvent({ type: "question", visibility: "private", occurredAt: iso(2),
    data: { text: "Travel plans at 32 weeks — okay?" } });
  t.seedEvent({ type: "appointment", visibility: "private", occurredAt: iso(8),
    data: { title: "Anatomy scan" } });
  return "seeded";
})()
"""

BANNED = [
    r"diagnos", r"\brisk\b", r"abnormal", r"normal range", r"severity",
    r"concerning", r"alarming", r"prognosis", r"recommend",
    r"clinician-reviewed", r"medically (reviewed|approved)",
]


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
        # SPA fallback: expo-router tab routes (e.g. /nurture/you) have no
        # static file; serve index.html so the router resolves client-side.
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def facts_only_ok(text):
    return [p for p in BANNED if re.search(p, text, re.IGNORECASE)]


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
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(BASE, timeout=30000)

        home = page.get_by_test_id("week-screen")
        try:
            home.wait_for(timeout=30000)
        except Exception:
            check("app boots to Week", False, "week-screen never appeared")
            browser.close()
            sys.exit(1)
        check("app boots to Week", True)

        seeded = page.evaluate(SEED_JS)
        check("seeded via test hooks", seeded == "seeded", str(seeded))

        # 1. You tab -> Export row.
        page.get_by_role("tab", name="You").click()
        row = page.get_by_test_id("export-ob-visit-row")
        try:
            row.wait_for(timeout=10000)
        except Exception:
            check("export row on You tab", False, "row never appeared")
        else:
            check("export row on You tab", True)
        row.click()

        screen = page.get_by_test_id("export-screen")
        try:
            screen.wait_for(timeout=10000)
        except Exception:
            check("export screen opens", False, "export-screen never appeared")
            browser.close()
            sys.exit(1)
        check("export screen opens", True)

        # 2. Default range + preview content.
        since = page.get_by_test_id("range-chip-since_last_visit")
        # RNW drops aria-selected on role=button, so assert the active
        # visual state (blush background) instead.
        bg = since.evaluate("el => getComputedStyle(el).backgroundColor")
        check("default range is Since last visit",
              bg == "rgb(246, 231, 221)", f"background={bg}")
        preview = page.get_by_test_id("summary-preview")
        ptext = preview.inner_text()
        check("preview mentions last appointment", "Since your last appointment" in screen.inner_text())
        check("preview shows symptom frequency", "Fatigue" in ptext and "2×" in ptext)
        check("preview shows weight trend", "139" in ptext and "142.5" in ptext)
        check("preview shows kick session", "12 movements" in ptext)
        check("preview shows shared note", "Slept through the night" in ptext)
        check("preview shows question", "Travel plans at 32 weeks" in ptext)
        check("private note excluded by default", "Private worry stays out" not in ptext)
        check("photo excluded by default", "bump.jpg" not in ptext)
        check("+Export partner note preselected", "Partner note for the OB" in ptext and "(partner)" in ptext)
        check("non-selected partner note excluded", "Partner private note stays out" not in ptext)

        # 3. Facts-only framing.
        check("framing label present",
              "A user-entered record — not a clinical chart." in ptext)
        check("generated timestamp present", "Generated" in ptext and "on this device" in ptext)
        bad = facts_only_ok(ptext)
        check("preview is facts-only", not bad, str(bad))

        # 4. Toggles: symptoms off -> section gone; add private notes -> appears.
        page.get_by_test_id("include-toggle-symptoms").click()
        ptext2 = preview.inner_text()
        check("symptom toggle removes section", "Fatigue" not in ptext2)
        page.get_by_test_id("add-private-notes").click()
        ptext3 = preview.inner_text()
        check("Add includes private note", "Private worry stays out by default." in ptext3)
        # Re-enable symptoms for the generated file below.
        page.get_by_test_id("include-toggle-symptoms").click()

        # 5. Generate -> web download.
        try:
            with page.expect_download(timeout=15000) as dl_info:
                page.get_by_test_id("generate-button").click()
            dl = dl_info.value
            dl_path = "/tmp/nurture-visit-summary.html"
            dl.save_as(dl_path)
            check("download triggered", True)
            with open(dl_path, "r", encoding="utf-8") as f:
                html = f.read()
            check("downloaded file is the summary",
                  "Visit summary" in html and "A user-entered record — not a clinical chart." in html)
            check("downloaded file has generated timestamp",
                  "Generated" in html and "on this device" in html)
            bad_html = facts_only_ok(html)
            check("downloaded file is facts-only", not bad_html, str(bad_html))
            check("downloaded filename", dl.suggested_filename.startswith("visit-summary-"),
                  dl.suggested_filename)
        except Exception as e:
            check("generate -> download", False, str(e)[:200])

        # 6. Stopped: export still works (contract C3). No reload here — the
        # afterwards Home state is Epic 9's territory; what matters for Epic 8
        # is that the export screen reads events directly and never gates on
        # pregnancy status.
        page.evaluate("() => window.__nurtureTest && window.__nurtureTest.stopPregnancy()")
        stopped = page.evaluate(
            "() => window.__nurtureTest && window.__nurtureTest.seedEvent ? 'hooks-ok' : 'no-hooks'")
        check("hooks survive stop (no reload needed)", stopped == "hooks-ok", str(stopped))
        # The export route sits outside the tab group (no tab bar there) —
        # go back to You first, then re-open the export screen.
        page.get_by_label("Back to You").click()
        page.get_by_test_id("export-ob-visit-row").click()
        try:
            page.get_by_test_id("export-screen").wait_for(timeout=10000)
            check("export works when stopped", True)
            pstext = page.get_by_test_id("summary-preview").inner_text()
            check("stopped preview still shows facts",
                  "Fatigue" in pstext and "not a clinical chart" in pstext)
        except Exception:
            check("export works when stopped", False, "export-screen never appeared")

        # 7. Zero page errors.
        check("zero page errors", not page_errors, "; ".join(page_errors[:3]))

        browser.close()
        if KEEP_OPEN:
            print("(keeping browser closed; --keep-open is a no-op in headless runs)")

    print(f"\n{len(failures)} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
