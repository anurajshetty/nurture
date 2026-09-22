#!/usr/bin/env python3
"""
Interactive browser test: feed-card sharing revision (mockup 33B, Anuraj
approved Sept 21, 2026; final family-icon art — option C "ink on blush" —
picked Sept 21, 2026).

Drives the REAL Willow web UI in real Chromium against the built dist/
served under /willow/ (same pattern as timeline_browser_test.py). Events
are seeded through the app's own test hooks (?testhooks=1 ->
window.__nurtureTest.seedEvent, backed by the real SQLite store).

Flows:
  1. boot at 390x844 -> zero page errors
  2. seed one shared note + one private note -> Logs tab
  3. shared card shows the FamilyShareIcon (testID event-card-share-icon-<id>)
     at the top-right, immediately left of the delete × (geometry asserted)
  4. unshared card shows the × alone — no icon
  5. no per-card sharing controls render anywhere (no share-switch
     testIDs, no "Shared"/"Not shared" card labels, no sharing captions)
  6. the family icon is not interactive (no button/pressable ancestor)
  7. tapping the × opens the delete confirmation (dialog appears; then
     cancelled — the entry survives)
  8. screenshots: shared card (icon + ×), unshared card (× only)

Run:  python3 tests/interactive/family_share_icon_test.py
"""

import mimetypes
import os
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-familyicon")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
SHOTS = os.path.join(REPO, "tests", "interactive", "shots")
os.makedirs(SHOTS, exist_ok=True)

SEED_JS = r"""
(async () => {
  const t = window.__nurtureTest;
  if (!t) return null;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: "2026-10-08" });
  const now = new Date().toISOString();
  const shared = await t.seedEvent({
    type: "note", visibility: "shared", occurredAt: now,
    data: { text: "Morning walk — felt great today." },
  });
  const priv = await t.seedEvent({
    type: "note", visibility: "private", occurredAt: now,
    data: { text: "Private thought for my eyes only." },
  });
  return { shared: shared.id, private: priv.id };
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
        # SPA fallback: expo-router tab routes (e.g. /willow/logs) have no
        # static file; serve index.html so the router resolves client-side.
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
            failures.append(name + (f": {detail}" if detail else ""))

    if not os.path.isfile(os.path.join(DIST, "index.html")):
        print("FAIL dist/index.html missing — run npm run export:web first")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/meta-chromium/chrome")
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        page.goto(BASE, timeout=30000)

        try:
            page.wait_for_function(
                "() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)

        ids = page.evaluate(SEED_JS)
        check("seeded shared + private notes", bool(ids and ids.get("shared") and ids.get("private")),
              str(ids)[:120])
        if not ids:
            browser.close()
            sys.exit(1)

        # Navigate DIRECTLY to the tab route with ?testhooks=1 (expo-router
        # drops the query on in-app redirects).
        page.goto(ORIGIN + "/willow/logs?testhooks=1", timeout=30000)
        shared_card = f'event-card-{ids["shared"]}'
        private_card = f'event-card-{ids["private"]}'
        try:
            page.get_by_test_id(shared_card).wait_for(timeout=30000)
            page.get_by_test_id(private_card).wait_for(timeout=30000)
        except Exception:
            check("both seeded cards rendered", False, "card testIDs never appeared")
            browser.close()
            sys.exit(1)

        # 3. Shared card: icon present, × present, icon left of ×.
        icon = page.get_by_test_id(f'event-card-share-icon-{ids["shared"]}')
        check("shared card shows the family icon", icon.count() == 1)
        x_btn = page.get_by_test_id(f'event-card-delete-{ids["shared"]}')
        check("shared card shows the delete ×", x_btn.count() == 1)
        if icon.count() == 1 and x_btn.count() == 1:
            ib, xb = icon.bounding_box(), x_btn.bounding_box()
            gap = xb["x"] - (ib["x"] + ib["width"])
            vcenter = abs((ib["y"] + ib["height"] / 2) - (xb["y"] + xb["height"] / 2))
            check("icon sits immediately left of the ×", -2 <= gap <= 12, f"gap={gap:.1f}")
            check("icon vertically centered on the ×", vcenter < 10, f"dy={vcenter:.1f}")
            # Icon must not be interactive: no button/pressable ancestor.
            interactive = page.evaluate(
                """(testID) => {
                  const el = document.querySelector(`[data-testid="${testID}"]`);
                  let n = el && el.parentElement;
                  while (n) {
                    if (n.tagName === "BUTTON" || n.getAttribute("role") === "button") return true;
                    n = n.parentElement;
                  }
                  return false;
                }""",
                f'event-card-share-icon-{ids["shared"]}',
            )
            check("family icon is not interactive", not interactive)

        # 4. Unshared card: × alone, no icon.
        check("unshared card shows no family icon",
              page.get_by_test_id(f'event-card-share-icon-{ids["private"]}').count() == 0)
        check("unshared card shows the delete ×",
              page.get_by_test_id(f'event-card-delete-{ids["private"]}').count() == 1)

        # 5. No per-card sharing controls anywhere on the feed.
        check("no share-switch testIDs on the feed",
              page.locator('[data-testid*="share-switch"]').count() == 0)
        for cid, label in ((shared_card, "shared"), (private_card, "unshared")):
            text = page.get_by_test_id(cid).inner_text()
            check(f"{label} card has no 'Shared' label", "Shared" not in text.split(), text[:120])
            check(f"{label} card has no 'Not shared' label", "Not shared" not in text)
            check(f"{label} card has no sharing caption",
                  "Shared with your partner" not in text)

        # 7. The × still opens delete confirmation (then cancel — entry survives).
        page.get_by_test_id(f'event-card-delete-{ids["private"]}').click()
        try:
            page.get_by_test_id("delete-card-dialog").wait_for(timeout=5000)
            check("tapping × opens the delete confirmation", True)
        except Exception:
            check("tapping × opens the delete confirmation", False, "dialog never appeared")
        page.get_by_test_id("delete-card-keep").click()
        page.wait_for_timeout(400)
        check("entry survives after cancelling delete",
              page.get_by_test_id(private_card).count() == 1)

        # 8. Screenshots.
        page.get_by_test_id(shared_card).screenshot(
            path=os.path.join(SHOTS, "family-icon-shared-card.png"))
        page.get_by_test_id(private_card).screenshot(
            path=os.path.join(SHOTS, "family-icon-unshared-card.png"))
        page.screenshot(path=os.path.join(SHOTS, "family-icon-logs.png"))
        print(f"screenshots saved to {SHOTS}/")

        check("zero page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURE(S)")
        sys.exit(1)
    print("\nAll family-share-icon browser checks passed.")


if __name__ == "__main__":
    main()
