#!/usr/bin/env python3
"""
Interactive test: v7 created_at repair migration in the BUILT web app.

Anuraj caught it live: the original v6 backfill wrote
created_at = occurred_at, and appointments carry the SCHEDULED (often
future) occurred_at — so a Scan scheduled 10:30 AM sorted above a moment
logged 7:32 AM. The v7 repair slots every row with created_at > now just
below the latest legitimately-logged item.

This exercises the REAL migration path end-to-end:
  1. Boot the built dist under /willow/ (fresh DB -> schema v7).
  2. Seed a moment (logged now) + an appointment (scheduled +2h).
  3. Rewrite the persisted SQLite image in localStorage: poison the
     appointment's created_at to the future (exactly what the original
     v6 backfill produced) and roll schema_version back to '6'.
  4. Reload -> applySchema runs the v7 repair at boot.
  5. Assert: the moment renders ABOVE the appointment in the Logs feed,
     schema_version is '7', and no created_at is in the future.
  6. Zero page errors throughout.

Run:  python3 tests/interactive/created_at_repair_test.py [--keep-open]
Must stay green before any push that touches the schema or timeline.
"""
import base64
import mimetypes
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
STORAGE_KEY = "nurture.db.v1"

KEEP_OPEN = "--keep-open" in sys.argv

SEED_JS = """
(() => {
  const t = window.__nurtureTest;
  if (!t) return "no-hooks";
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  const now = Date.now();
  t.seedEvent({ type: "note", occurredAt: new Date(now).toISOString(),
    data: { text: "Repair moment logged now" } });
  const appt = t.seedEvent({ type: "appointment",
    occurredAt: new Date(now + 2 * 3600e3).toISOString(),
    data: { title: "Repair scan" } });
  return appt.id;
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
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    if fpath.endswith(".wasm"):
        ctype = "application/wasm"
    with open(fpath, "rb") as f:
        body = f.read()
    return route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")


def poison_db(b64):
    """Decode the persisted SQLite image, poison it like the old v6
    backfill did (appointment created_at = future scheduled time), roll
    schema_version back to '6', and return the re-encoded image."""
    raw = base64.b64decode(b64)
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    try:
        tmp.write(raw)
        tmp.close()
        con = sqlite3.connect(tmp.name)
        try:
            appt_id = con.execute(
                "SELECT id FROM events WHERE type = 'appointment' AND deleted_at IS NULL"
            ).fetchone()[0]
            future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat().replace("+00:00", "Z")
            con.execute("UPDATE events SET created_at = ? WHERE id = ?", (future, appt_id))
            con.execute("UPDATE meta SET value = '6' WHERE key = 'schema_version'")
            con.commit()
            ver = con.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0]
            assert ver == "6", f"schema_version rollback failed: {ver!r}"
            created = con.execute("SELECT created_at FROM events WHERE id = ?", (appt_id,)).fetchone()[0]
            assert created == future, "poison write failed"
        finally:
            con.close()
        with open(tmp.name, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii"), appt_id
    finally:
        os.unlink(tmp.name)


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
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        page.goto(LOGS, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False)
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)

        # Seed through the real store (fresh DB, schema v7).
        appt_id = page.evaluate(SEED_JS)
        check("seeded moment + appointment", isinstance(appt_id, str) and len(appt_id) > 0,
              f"appt_id={appt_id!r}")

        # Rewrite the persisted DB: poison + roll back to v6, then reload
        # so the v7 repair migration runs at boot.
        b64 = page.evaluate(f"() => window.localStorage.getItem('{STORAGE_KEY}')")
        check("db persisted to localStorage", bool(b64))
        if not b64:
            browser.close()
            sys.exit(1)
        poisoned_b64, appt_id = poison_db(b64)
        page.evaluate(f"(b) => window.localStorage.setItem('{STORAGE_KEY}', b)", poisoned_b64)
        page.goto(LOGS, timeout=30000)
        try:
            page.wait_for_function("() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("app reboots after poison", False)
            browser.close()
            sys.exit(1)
        check("app reboots after poison", True)

        # The feed should now render both entries.
        try:
            page.get_by_test_id("timeline-list").wait_for(timeout=15000)
            page.wait_for_function(
                "() => document.body.innerText.includes('Repair scan') && "
                "document.body.innerText.includes('Repair moment logged now')",
                timeout=15000)
        except Exception:
            check("feed renders both entries", False)
            browser.close()
            sys.exit(1)
        check("feed renders both entries", True)

        feed_text = page.get_by_test_id("timeline-list").inner_text()
        moment_idx = feed_text.find("Repair moment logged now")
        scan_idx = feed_text.find("Repair scan")
        check("moment renders above the poisoned appointment (repair fixed the sort)",
              0 <= moment_idx < scan_idx,
              f"moment_idx={moment_idx} scan_idx={scan_idx}")

        # Verify the migration actually ran and wrote sane values.
        b64_after = page.evaluate(f"() => window.localStorage.getItem('{STORAGE_KEY}')")
        raw = base64.b64decode(b64_after)
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        try:
            tmp.write(raw)
            tmp.close()
            con = sqlite3.connect(tmp.name)
            try:
                ver = con.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0]
                check("schema_version is 7 after repair", ver == "7", f"ver={ver!r}")
                rows = con.execute(
                    "SELECT id, created_at FROM events WHERE deleted_at IS NULL").fetchall()
                now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                future_rows = [r for r in rows if r[1] is not None and r[1] > now_iso]
                check("no future created_at remains", len(future_rows) == 0,
                      f"future_rows={future_rows}")
                appt_created = con.execute(
                    "SELECT created_at FROM events WHERE id = ?", (appt_id,)).fetchone()[0]
                moment_created = con.execute(
                    "SELECT created_at FROM events WHERE type = 'note' AND deleted_at IS NULL"
                ).fetchone()[0]
                check("poisoned appointment slotted below the moment",
                      appt_created is not None and moment_created is not None
                      and appt_created < moment_created,
                      f"appt={appt_created} moment={moment_created}")
            finally:
                con.close()
        finally:
            os.unlink(tmp.name)

        check("zero page errors", len(page_errors) == 0, f"errors={page_errors[:3]}")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open)")
            page.wait_for_timeout(3600_000)
        browser.close()

    if failures:
        print(f"\n{len(failures)} FAILURES")
        sys.exit(1)
    print("\nall created_at repair checks passed")


if __name__ == "__main__":
    main()
