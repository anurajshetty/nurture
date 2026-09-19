#!/usr/bin/env python3
"""Focused verification: appointment detail screen changes (Anuraj Sept 2026).

1. The entire "DURING YOUR VISIT" section is gone (label + Add note button).
2. The reminder row defaults to "2 days before" (was "1 hour before");
   the "Change it in You → Notifications" hint stays.
3. Zero page errors at 390×844; saves a screenshot for the visual diff.

Run:  python3 tests/interactive/appointment_detail_verify.py [--keep-open]
"""
import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

SHOT = "/tmp/appt-detail-390x844.png"


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


def main():
    failures = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            failures.append(name)

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        page.goto(BASE, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False)
            browser.close()
            sys.exit(1)
        page.evaluate(
            "() => { const t = window.__nurtureTest; t.completeOnboarding();"
            " t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }")
        # Seed one appointment 6 days out, then open its detail directly.
        appt_id = page.evaluate(
            """() => { const t = window.__nurtureTest;
                const e = t.seedEvent({ type: 'appointment',
                  occurredAt: new Date(Date.now() + 6*864e5).toISOString(),
                  data: { title: 'Growth scan', note: 'Dr. Izu' } });
                return e.id; }""")
        check("appointment seeded", bool(appt_id))
        page.goto(f"{ORIGIN}/willow/plan?appointment={appt_id}&testhooks=1", timeout=30000)
        try:
            page.get_by_test_id("appointment-detail").wait_for(timeout=15000)
        except Exception:
            check("appointment detail renders", False)
            browser.close()
            sys.exit(1)
        check("appointment detail renders", True)
        page.wait_for_timeout(1200)
        body = page.evaluate("document.body.innerText")

        check("DURING YOUR VISIT section removed",
              "During your visit" not in body, "label still present")
        check("Add note button removed",
              page.get_by_test_id("appointment-add-note").count() == 0
              and "Add note" not in body, "button still present")
        check("reminder defaults to 2 days before",
              "2 days before" in body, f"body={body[:400]!r}")
        check("no stale 1 hour before",
              "1 hour before" not in body)
        check("hint stays: Change it in You → Notifications",
              "Change it in You" in body and "Notifications" in body)
        check("Your questions section intact", "your questions" in body.lower())

        page.screenshot(path=SHOT)
        print(f"screenshot: {SHOT}")
        check(f"zero page errors (got {len(errors)})", len(errors) == 0,
              "; ".join(errors[:3]))

        if KEEP_OPEN:
            print("keeping browser open (--keep-open)")
            page.wait_for_timeout(3600_000)
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURES: {failures}")
        sys.exit(1)
    print("\nAPPOINTMENT DETAIL VERIFY: ALL GREEN")


if __name__ == "__main__":
    main()
