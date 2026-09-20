# Mockup 15 — LOCKED Logs-page spec — post-release live verification checklist
Source: `~/workspace/app-ideas/pregnancy-tracker/design/15-logs-feed-changes.html`
Authority: mockup 15 is the authority. Report diffs, don't silently fix.

## Top section
- [ ] "Your story" heading (serif, 24px)
- [ ] Week pill next to it ("Week N ▾", pill border, coral-deep text)
- [ ] 4 filter chips, horizontally scrollable: All (active) · Reports · Appointments · Logs
- [ ] Each chip: icon dot + label, 44pt min-height

## Feed
- [ ] Week band divider ("Week N" + date range), sticky
- [ ] Appointment card: lilac chip + "Appointment", date/time, "Only you", chevron ›,
      title "what · where", place line, "2 questions to ask" (sage-green bold, NO reminder text)
- [ ] Tapping appointment card opens the editor
- [ ] Report card: Report chip, time, "Only you", serif title, summary body,
      "This isn't medical advice." always visible inside the card
- [ ] Summary clamps to 4 lines with NO "Read more"/"Show less" toggle
      (mockup shows the toggle as design exploration only — do NOT flag its absence)
- [ ] Interim entry reads "Summarizing your report…" with pulse
- [ ] Moment card: Moment chip, time, "Only you", title + text
- [ ] No file rows, no photos, no "Open ›" on report entries

## Bottom section
- [ ] Tab bar: exactly Week · Logs · You
- [ ] 72px coral + button, bottom-right, above the You tab (no white box)
- [ ] + menu: Appointment / Add report / Log entry pills, right-aligned, rise from button

## Appointment editor (from card tap)
- [ ] Title "Edit appointment" (edit) / "New appointment" (create)
- [ ] Fields: What's it for · When (date/time pills) · With whom/where · Notes ("Questions to ask the doctor")
- [ ] Save button

## Known mockup staleness (do NOT flag)
- Mockup sheet lede says "It will land in your Plan" — Plan tab was removed Sept 19;
  the live app correctly routes to /logs?appointment=<id>.
- Mockup "Read more" toggle — design exploration only; release ships 4-line clamp, no toggle.
- Mockup You tab already shows the v3 "bowed mother" SVG — the approved icon ships as a
  follow-up push (skipped from this batch; see release report).
