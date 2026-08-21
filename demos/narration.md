# sentry-tui — demo narration

Voiceover script, written as **beats**. One beat = one sentence or two of
narration mapped to one on-screen action.

The beat is the unit the whole pipeline runs on:

1. `bun run demo:tts` synthesizes each beat's `>` blockquote to `build/audio/BNN.mp3`
   and measures it with `ffprobe`, writing `build/durations.json`.
2. `demo.tape` says `Wait @BNN` where the action should hold for that beat.
3. `bun run demo:record` replays the tape into a real Kitty window and captures it.
4. `bun run demo:mux` lays each beat's audio at its exact offset on the timeline.

So the video is cut to the voice, not the other way round. Re-record one line and
only that beat's timing moves.

**Runtime: ~75 seconds**, of which the last 10 are a still frame of the install
command so viewers can copy it. The hard cap is three minutes; this is built to
land well inside it, which is why it sells the thing rather than explaining it.

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

> Thirty-five years later — terminal UIs are so back.

---

## Act 1 — The reveal

### B03 · it opens

**Screen:** `sentry-tui`, and the issue stream paints.

> This is Sentry. Not a status widget — the actual product, in your terminal.

### B04 · speed

**Screen:** hold on the loaded stream; `j` down a few rows.

> Two seconds to open. No tab to find, no dashboard to wait on — your issues are
> just there.

---

## Act 2 — All keyboard

### B05 · goto mode

**Screen:** `n` — every nav label grows a key. Then `i`, `f` back to Feed.

> It's built for the keyboard. Press n, and every destination tells you its key.
> Anywhere is two presses away.

### B06 · search and the palette

**Screen:** `/` and a query, then `ctrl+k` and a few letters.

> Slash to search. Control-K for a palette over every command there is.

### B07 · triage

**Screen:** Enter into an issue, `r` to resolve, Escape back.

> Triage without breaking stride — resolve, archive, bookmark. It lands instantly,
> and rolls back if the server disagrees.

---

## Act 3 — How much is here

### B08 · the whole surface

**Screen:** a fast montage — Logs, Replays, Releases, Profiles, then Seer.

> Logs, replays, releases, profiles — the whole Explore section, ported. And Seer,
> Sentry's agent, right in the same window.

### B09 · it's real

**Screen:** Seer working on a real question.

> All of this is the real app, making real requests against a real org.

---

## Act 4 — Outro

### B10 · install

**Screen:** back to a bare prompt with `npm install -g sentry-tui` typed and not
run. Holds for ten seconds so viewers can copy it.

> It's faster than the browser. Go find out for yourself.

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

### The install command has to be true before this ships

The outro holds `npm install -g sentry-tui` on screen for ten seconds
specifically so people run it. That package has to exist on npm by then — see
`bun run release:cut`. It is one `Type` line at the end of `demo.tape`.

### Claims the script makes, and what backs them

- **"Two seconds to open"** — measured: chrome paints at 0.8s, real rows with
  sparklines and counts by 2.0s.
- **"The whole Explore section"** — Logs, Replays, Releases and Profiles have
  real screens. Traces, Metrics, Discover and Conversations do not, and the
  montage doesn't visit them.
- **"Rolls back if the server disagrees"** — `useTriage` keeps the original and
  restores it on failure.
- **Keyboard only.** The app does take a mouse, and the script no longer says so
  — nothing in the tape clicks.
