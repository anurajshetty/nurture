#!/usr/bin/env python3
"""390x844 visual/interaction pass for the Willow evening batch.

Covers the batch's visible surfaces:
1. Week tab: "Coming up" card (kicker only — "2 questions to ask" removed
   at Anuraj's request, Sept 2026), tap -> editor.
2. Logs tab: report summary card shows exactly "This isn't medical advice.";
   interim "Summarizing your report..." entry shows it too.
3. Logs composer: dummy [+] tap -> "Photo uploads are paused for now" toast,
   no attach sheet opens, nothing attaches.
4. You tab: reminders cleanup (no global "Remind me" card, no "Set it once").
5. Zero page errors throughout.

Saves screenshots to .screenshots/batch/.
Run: python3 tests/interactive/batch_visual_pass.py
"""
import os, sys, mimetypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(REPO, "dist")
SHOT_DIR = os.path.join(REPO, ".screenshots", "batch")
os.makedirs(SHOT_DIR, exist_ok=True)

ORIGIN = "https://willow.test"
WEEK = ORIGIN + "/willow/week?testhooks=1"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
YOU = ORIGIN + "/willow/you?testhooks=1"

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

def serve_dist(route):
    url = route.request.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        fpath = os.path.join(DIST, "index.html")
    ctype, _ = mimetypes.guess_type(fpath)
    with open(fpath, "rb") as f:
        body = f.read()
    route.fulfill(status=200, body=body, content_type=ctype or "application/octet-stream")

SEED = """() => {
  const t = window.__nurtureTest;
  t.completeOnboarding();
  t.clearEvents();
  t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' });
  const now = new Date();
  const appt = new Date(now); appt.setDate(appt.getDate() + 1); appt.setHours(10, 30, 0, 0);
  t.seedEvent({ type: 'appointment', occurredAt: appt.toISOString(),
    data: { title: 'Growth scan', provider: 'Dr. Izu', questions: ['q1','q2'] } });
  t.seedEvent({ type: 'report', occurredAt: now.toISOString(),
    data: { reportSummary: { status: 'ready', title: 'Growth scan summary',
      summary: 'Baby is growing well. Everything looks normal.',
      attachmentName: 'scan.pdf', needsAttention: false, disclaimer: '' } } });
  t.seedEvent({ type: 'report', occurredAt: now.toISOString(),
    data: { reportSummary: { status: 'summarizing' } } });
}"""

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"))
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(ORIGIN + "/**", serve_dist)

        # --- Bundle markers: the dist bundle under test must carry the
        # v3 "bowed mother" You-tab icon path. If this marker is missing,
        # the release must NOT ship — stop and report.
        import glob as _glob
        _bundles = _glob.glob(os.path.join(DIST, "_expo", "static", "js", "web", "entry-*.js"))
        _bundle_text = ""
        for _b in _bundles:
            with open(_b, encoding="utf-8", errors="replace") as _f:
                _bundle_text += _f.read(2_000_000)
        check("bundle: v3 You-tab icon marker M10.6 9.6 present",
              "M10.6 9.6" in _bundle_text)

        # --- Week tab: Coming up card ---
        # Seed first, then (re)navigate so the tab picks up the events.
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED)
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_timeout(2500)
        cards = page.get_by_test_id("week-reminder-card")
        check("week: one 'Coming up' card renders", cards.count() == 1)
        card_text = cards.first.inner_text().lower() if cards.count() >= 1 else ""
        check("week: kicker is 'Coming up' (locked copy)", "coming up" in card_text)
        check("week: '2 questions to ask' line removed (Anuraj, Sept 2026)",
              "2 questions to ask" not in card_text)
        check("week: no reminder-lead-time text on card",
              "reminder 2 days before" not in card_text)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-coming-up.png"))
        # tap the card -> appointment editor
        cards.first.click()
        page.wait_for_timeout(1500)
        check("week: tapping card opens appointment editor",
              page.get_by_test_id("appointment-editor").count() >= 1)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-appointment-editor.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # --- Week size card: 3-subject RANDOM rotation (Anuraj Sept 20, 2026) ---
        # Displayed week d = completed + 1. MANIFEST.json maps week d to 3
        # subjects [keeper, slot2, slot3]; every Week-tab load picks a RANDOM
        # one, image + caption TOGETHER. Assert: heading "Week {d}"; every
        # load's image is one of week d's 3 manifest files; the caption
        # (week-size-name) is that file's CAPTIONS.json entry; nothing from
        # week {d-1}'s set leaks in; repeated loads vary (randomness);
        # You account row "Week {d}".
        import datetime as _dt, json as _json
        _lmp = _dt.date(2026, 1, 1)  # EDD 2026-10-08 minus 280 days
        _completed = (_dt.date.today() - _lmp).days // 7
        _displayed = _completed + 1
        _design_dir = "/home/hatch/workspace/app-ideas/pregnancy-tracker/design/size-images"
        _manifest = _json.load(open(os.path.join(_design_dir, "MANIFEST.json")))
        _captions = _json.load(open(os.path.join(_design_dir, "CAPTIONS.json")))
        _week_paths = _manifest.get(str(_displayed), [])
        _prev_paths = _manifest.get(str(_completed), [])
        _stems = [os.path.splitext(os.path.basename(p))[0] for p in _week_paths]
        _prev_stems = [os.path.splitext(os.path.basename(p))[0] for p in _prev_paths]
        _prev_captions = [_captions[p] for p in _prev_paths]
        check("size-3subject: displayed week resolves with 3 manifest subjects",
              12 <= _displayed <= 40 and len(_week_paths) == 3)
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_timeout(2500)
        _title = page.get_by_test_id("week-title")
        check("size-3subject: heading reads 'Week {d}' (displayed)".format(d=_displayed),
              _title.count() == 1 and _title.first.inner_text().strip() == f"Week {_displayed}")
        # 8 tab loads: every image must be one of week d's 3 subjects, and
        # the caption must be that subject's own caption.
        _loads = []
        for _i in range(8):
            page.goto(WEEK, wait_until="networkidle")
            page.wait_for_timeout(2000)
            # RNW puts the testID on the Image wrapper div; the real src
            # lives on the inner <img>.
            _img = page.get_by_test_id("week-size-art").locator("img")
            _src = _img.get_attribute("src") if _img.count() else None
            _cap = page.get_by_test_id("week-size-name")
            _cap_text = _cap.first.inner_text().strip() if _cap.count() else None
            _loads.append((_src, _cap_text))
        def _stem_of(src):
            for _s in _stems:
                if _s in (src or ""):
                    return _s
            return None
        check("size-3subject: size art renders on every load",
              all(_s for _s, _ in _loads))
        check("size-3subject: every load's image is a week-{d} subject".format(d=_displayed),
              all(_stem_of(_s) is not None for _s, _ in _loads))
        _captions_match = True
        for _src, _cap_text in _loads:
            _stem = _stem_of(_src)
            if _stem is None:
                _captions_match = False
                continue
            _mpath = next(p for p in _week_paths
                          if os.path.splitext(os.path.basename(p))[0] == _stem)
            if _cap_text != _captions[_mpath]:
                _captions_match = False
        check("size-3subject: caption is the shown subject's own caption (image+caption together)",
              _captions_match)
        _no_prev = all(
            not any(_ps in (_s or "") for _ps in _prev_stems)
            and _cap not in _prev_captions
            for _s, _cap in _loads
        )
        check("size-3subject: no week-{c} image/caption bleed-through".format(c=_completed),
              _no_prev)
        _distinct = len(set(_s for _s, _ in _loads))
        check("size-3subject: repeated loads vary across the 3 subjects (random)",
              _distinct >= 2)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-size-art.png"))
        # You tab account row
        page.goto(YOU, wait_until="networkidle")
        page.wait_for_timeout(2500)
        _you_line = page.get_by_test_id("you-pregnancy-line")
        check("size-3subject: You account row reads 'Week {d}' (displayed)".format(d=_displayed),
              _you_line.count() == 1
              and _you_line.first.inner_text().strip().startswith(f"Week {_displayed} ·"))

        # --- Logs tab: report cards + dummy [+] ---
        # (re)seed on the Logs route so the feed picks up the report events.
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_function("() => !!window.__nurtureTest", timeout=45000)
        page.evaluate(SEED)
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_timeout(2500)
        disclaimers = page.get_by_text("This isn't medical advice.", exact=True).count()
        check("logs: disclaimer on ready + interim/failed cards (>=2)", disclaimers >= 2)
        # The seeded 'summarizing' entry may flip to 'failed' on mount (no
        # stashed bytes); either way it must carry the fixed disclaimer.
        interim = (page.get_by_text("Summarizing your report").count() +
                   page.get_by_text("Couldn't read this one").count())
        check("logs: interim/failed report entry visible", interim >= 1)
        check("logs: no old 'Not medical advice' wording",
              page.get_by_text("Not medical advice").count() == 0)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-report-cards.png"), full_page=True)

        # dummy [+] : open Add menu -> Log entry, tap [+] -> paused toast, no sheet
        add_btn = page.get_by_role("button", name="Add").first
        if add_btn.count() == 0:
            add_btn = page.get_by_test_id("logs-add-button")
        add_btn.first.click()
        page.wait_for_timeout(800)
        page.get_by_text("Log entry").first.click()
        page.wait_for_timeout(1200)
        plus = page.get_by_role("button", name="Add photo")
        check("logs: composer [+] visible", plus.count() >= 1)
        plus.first.click()
        page.wait_for_timeout(800)
        check("logs: 'Photo uploads are paused for now' shown",
              page.get_by_text("Photo uploads are paused for now").count() >= 1)
        check("logs: no attach sheet opened",
              page.get_by_text("Add a photo").count() == 0 and
              page.get_by_text("Take a photo").count() == 0)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-photo-paused.png"))

        # --- Logs Add button: LOCKED bottom-right position (mockup 15) ---
        # The release agent's pass only asserted the button EXISTED — never
        # its position, which is how the centered-vs-bottom-right drift
        # shipped. Assert geometry, not just presence.
        # Fresh navigation: deterministic closed-menu state.
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_timeout(2000)
        add_btn2 = page.get_by_test_id("logs-add-button")
        bbox = add_btn2.bounding_box()
        tabbar_top = page.evaluate(
            "() => { const a = document.querySelector('a[href*=\"/willow/you\"]');"
            " return a ? a.getBoundingClientRect().top : null; }")
        check("add: + button box measurable", bbox is not None)
        if bbox is not None:
            right = bbox["x"] + bbox["width"]
            bottom = bbox["y"] + bbox["height"]
            check("add: + button right edge ~18px from screen edge (372px)",
                  abs(right - 372) <= 6)
            check("add: + button in lower half of screen", bbox["y"] > 844 / 2)
            if tabbar_top is not None:
                check("add: + button floats above the tab bar",
                      bottom < tabbar_top and bottom > tabbar_top - 80)
        # open the menu: pills must fan upward, right-aligned to the button
        add_btn2.click()
        page.wait_for_timeout(800)
        pill_ids = ["add-menu-pill-appointment", "add-menu-pill-report",
                    "add-menu-pill-log"]
        pill_boxes = [page.get_by_test_id(pid).bounding_box() for pid in pill_ids]
        check("add: three pills measurable on open",
              all(b is not None for b in pill_boxes))
        if all(b is not None for b in pill_boxes) and bbox is not None:
            btn_right = bbox["x"] + bbox["width"]
            for pid, pb in zip(pill_ids, pill_boxes):
                pright = pb["x"] + pb["width"]
                check(f"add: pill {pid} right-aligned to button",
                      abs(pright - btn_right) <= 8)
            # fanning upward: each pill sits above the previous, 10px gaps
            tops = [pb["y"] for pb in pill_boxes]
            check("add: pills stack upward (appointment topmost)",
                  tops[0] < tops[1] < tops[2])
            lowest_bottom = pill_boxes[2]["y"] + pill_boxes[2]["height"]
            check("add: pills rise from just above the button",
                  8 <= bbox["y"] - lowest_bottom <= 28)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-add-menu-open.png"))
        add_btn2.click()  # fold the menu away via ×
        page.wait_for_timeout(500)

        # --- You tab: reminders cleanup ---
        page.goto(YOU, wait_until="networkidle")
        page.wait_for_timeout(2500)
        check("you: no global 'Remind me' lead-time card",
              page.get_by_text("Remind me").count() == 0)
        check("you: no 'Set it once' helper text",
              page.get_by_text("Set it once").count() == 0)
        check("you: End-of-day nudge present",
              page.get_by_text("End-of-day nudge").count() >= 1)
        check("you: Nudge time present",
              page.get_by_text("Nudge time").count() >= 1)
        page.screenshot(path=os.path.join(SHOT_DIR, "you-reminders.png"), full_page=True)

        # --- You tab icon: v3 "bowed mother" SVG ---
        icon = page.evaluate("""() => {
          const svgs = Array.from(document.querySelectorAll('svg'));
          const youSvg = svgs.find(s =>
            s.getAttribute('viewBox') === '0 0 24 24' &&
            s.querySelectorAll('circle').length === 2 &&
            s.querySelectorAll('path').length === 3);
          if (!youSvg) return { found: false };
          const r = youSvg.getBoundingClientRect();
          const btn = youSvg.closest('a,button,[role="tab"]');
          const btnRect = btn ? btn.getBoundingClientRect() : null;
          return { found: true, w: r.width, h: r.height,
                   nearBottom: r.bottom > window.innerHeight - 140,
                   btnH: btnRect ? btnRect.height : 0, btnW: btnRect ? btnRect.width : 0,
                   v3path: Array.from(youSvg.querySelectorAll('path'))
                     .some(p => (p.getAttribute('d') || '').includes('M10.6 9.6')) };
        }""")
        check("you: v3 bowed-mother SVG renders (2 circles + 3 paths, 24x24 viewBox)",
              icon.get("found") is True)
        check("you: v3 path marker M10.6 9.6 present",
              icon.get("v3path") is True)
        check("you: icon sits in the tab bar (near viewport bottom)",
              icon.get("nearBottom") is True)
        check("you: icon renders at tab-icon size (~24px)",
              20 <= (icon.get("w") or 0) <= 28 and 20 <= (icon.get("h") or 0) <= 28)
        check("you: tab target >= 44pt",
              (icon.get("btnH") or 0) >= 44 and (icon.get("btnW") or 0) >= 44)
        check("you: old ☺ text glyph is gone",
              page.evaluate("() => !document.body.innerHTML.includes('☺')"))
        # tab-bar close-up screenshot (bottom strip)
        page.screenshot(path=os.path.join(SHOT_DIR, "you-tab-icon.png"),
                        clip={"x": 0, "y": 844 - 110, "width": 390, "height": 110})

        # --- Tab bar icons: all three tabs, active + inactive tints ---
        # Spec (mockup 15 tab bar, locked): Week = bullseye (2 concentric
        # circles r=4/r=9), Logs = clock (circle r=9 + "M12 7v5l3 3"),
        # You = v3 bowed mother. 24x24 viewBox, 2px round stroke;
        # active tint #C85F3E (coralDeep), inactive #8A8078 (muted).
        # Currently on the YOU tab: You active, Week + Logs inactive.
        ICON_JS = """() => {
          const norm = (c) => (c || '').toLowerCase().replace(/\\s+/g, '');
          const isActive = (c) => norm(c) === '#c85f3e' || norm(c) === 'rgb(200,95,62)';
          const isInactive = (c) => norm(c) === '#8a8078' || norm(c) === 'rgb(138,128,120)';
          const svgs = Array.from(document.querySelectorAll('svg'))
            .filter(s => s.getAttribute('viewBox') === '0 0 24 24')
            .filter(s => { const r = s.getBoundingClientRect();
                           return r.bottom > window.innerHeight - 140; });
          const out = {};
          for (const s of svgs) {
            const circles = Array.from(s.querySelectorAll('circle'));
            const paths = Array.from(s.querySelectorAll('path'));
            const radii = circles.map(c => c.getAttribute('r')).sort().join(',');
            const g = s.querySelector('g');
            const stroke = g ? (g.getAttribute('stroke') ||
                                getComputedStyle(g).stroke) : '';
            const r = s.getBoundingClientRect();
            const info = { stroke, w: r.width, h: r.height,
                           active: isActive(stroke), inactive: isInactive(stroke) };
            if (circles.length === 2 && paths.length === 0 && radii === '4,9')
              out.week = info;
            else if (circles.length === 1 && paths.length === 1 &&
                     radii === '9' && paths[0].getAttribute('d') === 'M12 7v5l3 3')
              out.logs = info;
            else if (circles.length === 2 && paths.length === 3)
              out.you = info;
          }
          return out;
        }"""
        icons = page.evaluate(ICON_JS)
        check("tabbar: Week bullseye SVG found (2 concentric circles r=4/r=9)",
              "week" in icons)
        check("tabbar: Logs clock SVG found (circle r=9 + hands 'M12 7v5l3 3')",
              "logs" in icons)
        check("tabbar: You v3 icon present", "you" in icons)
        for tab in ("week", "logs", "you"):
            if tab in icons:
                i = icons[tab]
                check(f"tabbar: {tab} icon ~24px",
                      20 <= (i.get("w") or 0) <= 28 and 20 <= (i.get("h") or 0) <= 28)
        check("tabbar: on You tab, You icon is active tint (#C85F3E)",
              icons.get("you", {}).get("active") is True)
        check("tabbar: on You tab, Week icon is inactive tint (#8A8078)",
              icons.get("week", {}).get("inactive") is True)
        check("tabbar: on You tab, Logs icon is inactive tint (#8A8078)",
              icons.get("logs", {}).get("inactive") is True)
        check("tabbar: old text glyphs gone from tab bar (no ◍, no ☰, no ☺)",
              page.evaluate("""() => {
                const bar = document.body.innerHTML;
                const tabHtml = Array.from(document.querySelectorAll('svg'))
                  .filter(s => { const r = s.getBoundingClientRect();
                                 return r.bottom > window.innerHeight - 140; })
                  .map(s => { const b = s.closest('a,button,[role="tab"]');
                               return b ? b.innerHTML : ''; }).join('');
                return !['◍','☰','☺'].some(g => tabHtml.includes(g));
              }"""))

        # Week tab active: Week icon active, others inactive.
        page.goto(WEEK, wait_until="networkidle")
        page.wait_for_timeout(2000)
        icons = page.evaluate(ICON_JS)
        check("tabbar: on Week tab, Week icon is active tint",
              icons.get("week", {}).get("active") is True)
        check("tabbar: on Week tab, Logs icon is inactive tint",
              icons.get("logs", {}).get("inactive") is True)
        check("tabbar: on Week tab, You icon is inactive tint",
              icons.get("you", {}).get("inactive") is True)
        page.screenshot(path=os.path.join(SHOT_DIR, "week-tab-icon.png"),
                        clip={"x": 0, "y": 844 - 110, "width": 390, "height": 110})

        # Logs tab active: Logs icon active, others inactive.
        page.goto(LOGS, wait_until="networkidle")
        page.wait_for_timeout(2000)
        icons = page.evaluate(ICON_JS)
        check("tabbar: on Logs tab, Logs icon is active tint",
              icons.get("logs", {}).get("active") is True)
        check("tabbar: on Logs tab, Week icon is inactive tint",
              icons.get("week", {}).get("inactive") is True)
        check("tabbar: on Logs tab, You icon is inactive tint",
              icons.get("you", {}).get("inactive") is True)
        page.screenshot(path=os.path.join(SHOT_DIR, "logs-tab-icon.png"),
                        clip={"x": 0, "y": 844 - 110, "width": 390, "height": 110})

        check("zero page errors", len(errors) == 0)
        for e in errors[:5]:
            print("  pageerror:", e[:200])
        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\nbatch visual pass: {len(results)-len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
