#!/usr/bin/env python3
"""
Standing interactive browser test: voice dictation stop behavior.

Drives the REAL Willow web UI in real Chromium: real expo-speech-recognition
web module, real voice.ts session manager, real Composer button wiring. The
only fake is the browser speech backend itself (an in-page
webkitSpeechRecognition faithful to Chrome semantics: stop() -> final result
-> end; abort() -> 'aborted' error -> end; OS end -> bare 'end').

Run:  python3 tests/interactive/voice_browser_test.py [--keep-open]
Must stay green before any push that touches the composer.

Flows:
  1. start  -> listening UI appears, recognition started
  2. stop   -> recognition stopped, NO restart afterwards, UI back to mic
  3. os-end -> seamless restart, listening continues
  4. stop-during-restart-race -> stays stopped, no restart
"""

import json
import mimetypes
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPO = os.path.expanduser("~/workspace/nurture-v12")
DIST = os.path.join(REPO, "dist")
ORIGIN = "https://nurture.test"
BASE = ORIGIN + "/willow/?testhooks=1"
LOGS = ORIGIN + "/willow/logs?testhooks=1"
KEEP_OPEN = "--keep-open" in sys.argv

FAKE_SR_JS = r"""
(() => {
  const log = [];
  window.__srLog = log;
  window.__srInstances = [];
  let seq = 0;
  const now = () => performance.now();
  const resultEvent = (transcript, isFinal) => ({
    type: "result",
    timeStamp: now(),
    resultIndex: 0,
    results: [Object.assign([{ transcript, confidence: 0.92 }], { isFinal })],
  });
  class FakeSpeechRecognition {
    constructor() {
      this.__id = ++seq;
      this.lang = "";
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.continuous = false;
      this.__started = false;
      this.__listeners = {};
      for (const n of ["start","audiostart","soundstart","speechstart","speechend",
                       "soundend","audioend","result","nomatch","error","end"]) {
        this["on" + n] = null;
      }
      log.push({ t: now(), kind: "construct", id: this.__id });
      window.__srInstances.push(this);
    }
    addEventListener(name, fn) {
      (this.__listeners[name] = this.__listeners[name] || new Set()).add(fn);
    }
    removeEventListener(name, fn) {
      if (this.__listeners[name]) this.__listeners[name].delete(fn);
    }
    __emit(name, ev) {
      ev = ev || { type: name, timeStamp: now() };
      (this.__listeners[name] || new Set()).forEach((fn) => { try { fn(ev); } catch (e) {} });
      const prop = this["on" + name];
      if (typeof prop === "function") { try { prop(ev); } catch (e) {} }
    }
    start() {
      // Faithful: Chrome throws if start() is called while already started.
      if (this.__started) throw new DOMException("already started", "InvalidStateError");
      this.__started = true;
      log.push({ t: now(), kind: "start", id: this.__id, continuous: this.continuous });
      setTimeout(() => this.__emit("start"), 0);
    }
    stop() {
      // Faithful: Chrome delivers final result(s), then end.
      log.push({ t: now(), kind: "stop", id: this.__id });
      this.__started = false;
      setTimeout(() => {
        this.__emit("result", resultEvent("final words on stop", true));
        this.__emit("end");
      }, 30);
    }
    abort() {
      log.push({ t: now(), kind: "abort", id: this.__id });
      this.__started = false;
      setTimeout(() => {
        this.__emit("error", { type: "error", timeStamp: now(), error: "aborted", message: "" });
        this.__emit("end");
      }, 0);
    }
  }
  window.webkitSpeechRecognition = FakeSpeechRecognition;
  window.__srDriver = {
    current() {
      const a = window.__srInstances;
      return a.length ? a[a.length - 1] : null;
    },
    log: () => log.slice(),
    starts: () => log.filter((e) => e.kind === "start"),
    stops: () => log.filter((e) => e.kind === "stop"),
    aborts: () => log.filter((e) => e.kind === "abort"),
    emitInterim(text) {
      const inst = this.current();
      if (inst && inst.__started) inst.__emit("result", resultEvent(text, false));
    },
    // OS-initiated end (request limit / silence endpointer): bare 'end'.
    osEnd() {
      const inst = this.current();
      if (inst) { inst.__started = false; setTimeout(() => inst.__emit("end"), 10); }
    },
    noSpeech() {
      const inst = this.current();
      if (inst) {
        inst.__started = false;
        setTimeout(() => {
          inst.__emit("error", { type: "error", timeStamp: now(), error: "no-speech", message: "" });
          inst.__emit("end");
        }, 10);
      }
    },
  };
})();
"""


def serve_dist(route):
    req = route.request
    url = req.url
    assert url.startswith(ORIGIN), url
    path = url[len(ORIGIN):]
    # Map /willow/* -> dist/*
    if not path.startswith("/willow/"):
        return route.fulfill(status=404, body="not found")
    rel = path[len("/willow/"):]
    if rel == "" or rel.endswith("/"):
        rel = "index.html"
    fpath = os.path.join(DIST, rel)
    if not os.path.isfile(fpath):
        # SPA fallback (see timeline_browser_test.py): tab routes like
        # /willow/logs have no static file; serve index.html so
        # expo-router resolves them client-side.
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

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/opt/meta-chromium/chrome",
            args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(FAKE_SR_JS)
        # Serve the whole app from dist/ — dodges the sandbox's localhost block.
        ctx.route("**://nurture.test/**", serve_dist)
        page = ctx.new_page()
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))
        page.goto(BASE, timeout=30000)
        try:
            page.wait_for_function(
                "() => window.__nurtureTest !== undefined", timeout=30000)
        except Exception:
            check("test hooks installed", False, "window.__nurtureTest never appeared")
            browser.close()
            sys.exit(1)
        check("test hooks installed", True)
        # Fresh profile boots to onboarding (Week-as-home change) — complete
        # it via the hooks, then go DIRECTLY to the Logs tab (expo-router
        # drops the query on in-app tab navigation).
        page.evaluate(
            "() => { const t = window.__nurtureTest; "
            "t.completeOnboarding(); "
            "t.seedPregnancy({ dueDate: '2026-10-08', parity: 'first' }); }"
        )
        page.goto(LOGS, timeout=30000)
        try:
            page.get_by_test_id("logs-screen").wait_for(timeout=15000)
        except Exception:
            check("logs screen boots", False, "logs-screen never appeared")
            browser.close()
            sys.exit(1)
        check("logs screen boots", True)
        # The composer now lives behind the Logs-tab Add button (Sept 2026):
        # + -> Log entry floats the real composer above a light scrim.
        page.get_by_test_id("logs-add-button").click()
        page.get_by_test_id("add-menu").wait_for(timeout=5000)
        page.get_by_test_id("add-menu-pill-log").click()
        try:
            page.get_by_test_id("floating-composer").wait_for(timeout=5000)
        except Exception:
            check("log entry floats the composer", False)
            browser.close()
            sys.exit(1)
        check("log entry floats the composer", True)
        mic = page.get_by_role("button", name="Dictate a moment")
        try:
            mic.wait_for(timeout=30000)
        except Exception:
            check("app boots to composer", False, "mic button never appeared")
            print("body text:", page.evaluate("document.body.innerText").slice(0, 300))
            browser.close()
            sys.exit(1)
        check("app boots to composer", True)
        stop_btn = page.get_by_role("button", name="Stop dictation")
        field = page.get_by_role("textbox", name="Save a moment")

        def sr(kind):
            return page.evaluate(f"window.__srDriver.{kind}().length")

        def starts_after(t):
            return page.evaluate(
                """(t) => window.__srDriver.log().filter(e => e.kind==='start' && e.t > t).length""",
                t,
            )

        # ---- Flow 1: start -> listening ----
        mic.click()
        try:
            stop_btn.wait_for(timeout=5000)
        except Exception:
            check("flow1: listening UI appears after mic tap", False)
        else:
            check("flow1: listening UI appears after mic tap", True)
        page.wait_for_timeout(400)
        check("flow1: recognition start() called", sr("starts") >= 1,
              f"starts={sr('starts')}")
        page.evaluate("window.__srDriver.emitInterim('feeling great today')")
        page.wait_for_timeout(300)
        check("flow1: interim transcript lands in field",
              "feeling great today" in (field.input_value() or ""),
              f"field={field.input_value()!r}")

        # ---- Flow 2: stop -> fully stopped, no restart ----
        t_stop = page.evaluate("performance.now()")
        stop_btn.click()
        page.wait_for_timeout(3000)  # > stop grace (2500ms) + restart delay (350ms)
        check("flow2: recognition stop() called", sr("stops") >= 1,
              f"stops={sr('stops')}")
        check("flow2: NO restart after user stop", starts_after(t_stop) == 0,
              f"starts after stop click: {starts_after(t_stop)}")
        check("flow2: stop button gone", stop_btn.count() == 0,
              "stop button still visible")
        # Post-stop the action button is "Save moment" (field has text) or
        # "Dictate a moment" (field empty) — either means dictation ended.
        action_back = (
            page.get_by_role("button", name="Dictate a moment").count() > 0
            or page.get_by_role("button", name="Save moment").count() > 0
        )
        check("flow2: action button back (mic or send)", action_back)
        ph = page.evaluate(
            "document.querySelector('[aria-label=\"Save a moment\"]')"
            ".getAttribute('placeholder')"
        )
        check("flow2: placeholder left listening state",
              ph is None or "Listening" not in ph, f"placeholder={ph!r}")

        # ---- Flow 3: OS-initiated end -> seamless restart ----
        # Clear the field so the mic (not send) button shows.
        field.click()
        field.press("ControlOrMeta+a")
        field.press("Backspace")
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Dictate a moment").click()
        stop_btn.wait_for(timeout=5000)
        page.wait_for_timeout(400)
        n_before = sr("starts")
        t_os = page.evaluate("performance.now()")
        page.evaluate("window.__srDriver.osEnd()")
        page.wait_for_timeout(1500)
        check("flow3: session restarts after OS end", sr("starts") > n_before,
              f"starts before={n_before} after={sr('starts')}")
        check("flow3: still listening after restart",
              stop_btn.count() > 0, "stop button gone")

        # ---- Flow 4: stop during the restart race window ----
        page.evaluate("window.__srDriver.osEnd()")  # -> 350ms restart window opens
        page.wait_for_timeout(80)  # inside the race window
        t_race = page.evaluate("performance.now()")
        stop_btn.click()
        page.wait_for_timeout(3000)
        check("flow4: stop during race -> no restart", starts_after(t_race) == 0,
              f"starts after race stop: {starts_after(t_race)}")
        check("flow4: stop button gone", stop_btn.count() == 0,
              "stop button still visible")
        action_back = (
            page.get_by_role("button", name="Dictate a moment").count() > 0
            or page.get_by_role("button", name="Save moment").count() > 0
        )
        check("flow4: action button back (mic or send)", action_back)

        # ---- Flow 5: quick stop (no interim) -> final transcript kept ----
        # Regression: the final result delivered on stop() was dropped,
        # emptying the field when stop was tapped before any interim.
        field.click()
        field.press("ControlOrMeta+a")
        field.press("Backspace")
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Dictate a moment").click()
        stop_btn.wait_for(timeout=5000)
        page.wait_for_timeout(300)
        # No interim emitted — the only transcript arrives as the final on stop().
        stop_btn.click()
        page.wait_for_timeout(3000)
        final_text = field.input_value() or ""
        check("flow5: quick-stop final transcript preserved",
              "final words on stop" in final_text, f"field={final_text!r}")
        check("flow5: no restart after quick stop",
              stop_btn.count() == 0, "stop button still visible")

        if KEEP_OPEN:
            print("keeping browser open (--keep-open); Ctrl-C to exit")
            try:
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                pass
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        sys.exit(1)
    print("ALL VOICE BROWSER TESTS PASSED")


if __name__ == "__main__":
    main()
