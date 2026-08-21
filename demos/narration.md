# sentry-tui — demo narration

Voiceover script, written as **beats**. One beat = one sentence or two of
narration mapped to one on-screen action.

The beat is the unit the whole pipeline runs on:

1. `bun run demo:tts` synthesizes each beat's `>` blockquote, corrects it onto the
   script's one speaking rate (`build/audio/paced/BNN.mp3`), and measures that,
   writing `build/durations.json`.
2. `demo.tape` says `Wait @BNN` where the action should hold for that beat.
3. `bun run demo:record` replays the tape into a real Kitty window and captures it.
4. `bun run demo:mux` lays each beat's audio at its exact offset on the timeline.

So the video is cut to the voice, not the other way round. Re-record one line and
only that beat's timing moves.

**Runtime: about 95 seconds** — 64 of narration, the rest spent letting screens
finish loading and holding them long enough to be read, and the last 10 a still
frame of the install command so viewers can copy it. The hard cap is three
minutes; this is built to land well inside it, which is why it sells the thing
rather than explaining it.

Every beat is read at the same pace, and that is enforced rather than requested —
see [Pace](README.md#pace-every-beat-reads-at-the-same-speed). Don't reach for a
`**Emphasis:**` override to fill a gap in the picture; an inconsistent read is
the most audible thing in a demo.

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

> Back in the day, we browsed the web through a terminal.

### B02 · out of lynx

**Screen:** a page-down, then out to a bare prompt.

> Thirty-five years later — terminal UIs are so fucking back.

---

## Act 1 — The reveal

### B03 · it opens

**Screen:** `sentry-tui`, and the issue stream paints.

> This is Sentry, not screenshots — the actual UI, in YOUR terminal.

### B04 · speed

**Screen:** hold on the loaded stream; `j` down a few rows.

> Lightning fast to open. No tab to find, no dashboard to wait on.

---

## Act 2 — All keyboard

### B05 · goto mode

**Screen:** `n` — every nav label grows a key. Then `i`, `f` back to Feed.

> It's built for the keyboard. Press n, and every destination tells you its key.

### B06 · the palette, and a question for Seer

**Screen:** `/` and a query, then `ctrl+k` → `ask seer` → the question, sent.
**Note:** reach Seer through the palette, never goto — goto's item key leaks into
the composer and the question comes out as `aWhich project…`.

> Slash to search. Control-K is a palette over every command.

### B07 · triage

**Screen:** back to the feed, Enter into an issue, `r` to resolve, Escape.

> Then triage without breaking stride. Resolve, archive, bookmark — instant, and
> it rolls back if the server disagrees.

---

## Act 3 — While Seer works

### B08 · dashboards

**Screen:** `n`, `d`, `a`, Enter — the starred dashboard, scrolling its widgets.

> Dashboards are here too. Real widgets, real series, no eCharts, drawn in the terminal at
> whatever size your window happens to be.

### B09 · the rest of Explore

**Screen:** Logs, Replays, Releases, Profiles — each one waited for and held.
**Note:** the line is shorter than the montage on purpose. Four screens that have
actually loaded take longer to show than one sentence takes to say, and skeletons
on screen would undercut the claim the sentence is making.

> Logs, replays, releases, profiles. The whole Explore section, ported.

### B10 · Seer answered

**Screen:** back to Seer via the palette; the finished conversation, scrolled.

> Talk to Seer, just like in the web app, but in your terminal.

---

## Act 4 — Outro

### B11 · install

**Screen:** back to a bare prompt with `npx sentry-tui` typed and not
run. Holds for ten seconds so viewers can copy it.

> This is the next generation of user interfaces. Go see for yourself. And no, it doesn't run on Windows, sorry Bruno.

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
