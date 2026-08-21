# sentry-tui — demo narration

Voiceover script, written as **beats**. One beat = one sentence or two of
narration mapped to one on-screen action.

The beat is the unit the whole pipeline runs on:

1. `bun run demo:tts` synthesizes each beat's `>` blockquote to
   `build/audio/BNN.mp3` and measures it, writing `build/durations.json`.
2. `demo.tape` says `Wait @BNN` where the action should hold for that beat.
3. `bun run demo:record` replays the tape into a real Kitty window and captures it.
4. `bun run demo:mux` lays each beat's audio at its exact offset on the timeline.

So the video is cut to the voice, not the other way round. Re-record one line and
only that beat's timing moves.

**Runtime: about two minutes and ten seconds** — 64 of narration, the rest spent letting screens
finish loading and holding them long enough to be read, and the last 10 a still
frame of the install command so viewers can copy it. The hard cap is three
minutes; this is built to land well inside it, which is why it sells the thing
rather than explaining it.

The audio is whatever the synthesizer returns — nothing resamples it, because a
processed voice is the most audible thing in a demo. `demo:tts` reports how each
line came out and flags the rushed ones; the fix is the writing, or an
`**Emphasis:**` on that beat, which asks the model to read it slower. See
[Pace](README.md#pace-measured-not-corrected).

## What this is and isn't

It's a pitch, not a tour. Every beat is a reason to want the app — it's fast,
it's light, it's all keyboard, it's real — and none of them enumerate features or
explain how anything is built. The screen does the showing; the voice does the
selling.

Deliberately absent: the CLI, `--help`, the login flow, and anything about
implementation. Nothing but the TUI after the cold open.

**Before recording**, run `bun run demo:seer-prep` — the last screens hit Seer,
which only answers for orgs where the Explorer agent is enabled.

---

## Act 0 — Cold open

### B01 · lynx renders sentry.io

**Screen:** full-screen `lynx https://sentry.io`, mid-page.

> A long long time ago, we browsed the web through a terminal.

### B02 · out of lynx

**Screen:** a page-down, then out to a bare prompt.

> Thirty-five years later — terminal UIs are so fucking back.

---

## Act 1 — The reveal

### B03 · it opens

**Screen:** `sentry-tui`, and the issue stream paints.

> Welcome to the next generation Sentry, all in YOUR terminal.

### B04 · speed

**Screen:** hold on the loaded stream; `j` down a few rows.

> Lightning fast to open. No leaving Claude's side, no tab to find.

---

## Act 2 — All keyboard

### B05 · goto mode

**Screen:** `n` — every nav label grows a key. Then `i`, `f` back to Feed.

> It's built for the keyboard. Press n, and every destination tells you its key.

### B06 · the palette, and a question for Seer

**Screen:** `/` and a query, then `ctrl+k` → `ask seer` → the question, sent.
**Note:** reach Seer through the palette, never goto — goto's item key leaks into
the composer and the question comes out as `aWhich project…`.

> Slash to update your search queries. Command-K is also here to bring you comfort.

### B07 · triage

**Screen:** back to the feed, Enter into an issue, `r` to resolve, Escape.

> Triage without breaking stride. Resolve, archive, bookmark — instant, and
> it rolls back if the server disagrees.

---

## Act 3 — While Seer works

### B08 · dashboards

**Screen:** `n`, `d`, `a`, Enter — the starred dashboard, scrolling its widgets.

> Dashboards are here too. Real widgets, real series, no eCharts, just love.

### B09 · Profiles

**Screen:** Explore › Profiles, the aggregate flamegraph note and the slowest
functions, already loaded when the word is said.

> Profiles.

### B10 · Releases

**Screen:** Explore › Releases.

> Releases.

### B11 · Replays

**Screen:** Explore › Replays.

> Replays.

### B12 · Logs

**Screen:** Explore › Logs.

> Logs.

### B13 · Traces, and the query builder

**Screen:** Explore › Traces. `V` opens Visualize and the aggregate becomes p95;
`B` groups by `span.op`, which turns a page of spans into one row per group with
a proportional bar.
**Note:** the longest beat in Act 3, and the only one doing more than arriving —
grouping is the moment the toolbar stops being chrome and starts being a query.

> Explore at your fingertips. Simple to browse, simple to use, simple.

### B14 · Seer answered

**Screen:** back to Seer via the palette; the finished conversation, scrolled.

> Talk to Seer, just like you would in the web app, but in your favorite terminal.

---

## Act 4 — Outro

### B15 · install

**Screen:** back to a bare prompt with `npx sentry-tui` typed and not
run. Holds for ten seconds so viewers can copy it.

> This is the cutting edge of user interfaces. Go see it for yourself. And no, I'm never adding Windows support, sorry Bruno.

---

## Fidelity notes

### Why this records in Kitty and not VHS

The nav icons, org avatar, platform icons and assignee avatars all render through
`<image>`, and `useImageSupport` turns them off unless the terminal reports kitty
graphics or sixel **and** `HERDR_ENV` / `TMUX` / `STY` are unset. VHS renders
through a headless browser terminal that doesn't advertise kitty graphics, and a
Herdr pane is excluded by name. Both would produce a text-only nav rail.

### Goto keys are derived, not fixed

The keys the tape presses in goto mode are assigned at runtime from the nav
**labels**, so renaming an item silently changes them.
`demos/lib/tape.test.ts` pins the ones the tape depends on and fails if a press
would land on a section that isn't implemented.

### The install command

The outro holds `npx sentry-tui` on screen for about twelve seconds specifically
so people run it. `sentry-tui` is published (0.1.0 at the time of writing), so it
works — but check `npm view sentry-tui version` before a re-record, and keep the
command in step with the README. It is one `Type` line at the end of `demo.tape`.

### Claims the script makes, and what backs them

- **"Two seconds to open"** — measured: chrome paints at 0.8s, real rows with
  sparklines and counts by 2.0s.
- **"The whole Explore section"** — every item now has a real screen; the
  montage visits four of them, and waits for each to fill before moving on.
- **lynx needs 5–8 seconds** to render sentry.io, and it varies. B01 waits with
  a `Settle` rather than a fixed `Sleep`, because every key after it goes into
  the page: if the load isn't finished, the quit never happens and `sentry-tui`
  gets typed into lynx instead of the shell. Quitting uses capital `Q`, which
  exits outright — lowercase `q` raises an "are you sure" prompt that is one more
  thing to mistime.
- **Seer takes about 25 seconds** to answer this question — measured: first tool
  step at 21s, answer complete at 25s. That is why it is asked back in B06,
  four beats before the answer is shown: triage, dashboards and the Explore
  montage exist partly to cover the wait with something worth watching. The
  `Settle` before B10 absorbs whatever is left, so the conversation is always
  fully rendered before the camera returns to it.
- **"Rolls back if the server disagrees"** — `useTriage` keeps the original and
  restores it on failure.
- **Keyboard only.** The app does take a mouse, and the script no longer says so
  — nothing in the tape clicks.
