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

**Runtime:** ~4:20 at 165 wpm. Beats marked `[CUT]` are the ones to drop first —
without them it lands around 3:10.

Everything narrated here is implemented and working. See
[Fidelity notes](#fidelity-notes) for what's deliberately absent and why.

---

## Act 0 — Cold open

### B01 · lynx renders sentry.io

**Screen:** full-screen `lynx https://sentry.io`, mid-page.

> Back in the day, we browsed the web through the terminal.

### B02 · out of lynx

**Screen:** a page-down or two, then `q` out to a bare prompt.

> Thirty-five years later — terminal UIs are so fucking back.

### B03 · the app launches

**Screen:** `sentry-tui` starting; hold on the first painted frame.

> Introducing Sentry. In your terminal.

---

## Act 1 — First run

### B04 · the CLI surface

**Screen:** `sentry-tui --help`

> Everything starts at the command line. One binary, four commands.

### B05 · no credentials yet

**Screen:** `sentry-tui` with `SENTRY_TUI_CONFIG_DIR` pointed at an empty temp
directory, so startup finds nothing and offers the device flow. Answer `n` and
let the fallback message print.

> Start it with no credentials and it offers to sign you in — a real OAuth device
> flow, so you never have to paste a long-lived token into a shell. Say no and it
> tells you about personal tokens instead.

---

## Act 2 — First paint

### B06 · skeleton to data

**Screen:** `sentry-tui` launching for real. Skeleton rows, then the stream.
**Tip:** `SENTRY_TUI_LATENCY=900` makes the skeleton actually visible.

> Start it up and you land on the issue stream. While the request is in flight the
> list draws itself as a skeleton — the shape arrives before the data does.

### B07 · the layout

**Screen:** slow beat on the whole frame; Tab once to move the focus box to the
nav rail and back.

> Five nav groups down the left, mirroring the web app's real information
> architecture. The content pane. And a status bar that owns every piece of
> activity in the app — if something is loading it says so, and past two seconds
> it starts counting, so slow never looks like hung.

---

## Act 3 — The issue stream

### B08 · row anatomy

**Screen:** static on the stream. Let the viewer read a few rows.

> The default query is Sentry's own — unresolved, high and medium priority, over
> fourteen days. Every row carries a colored level bar, the exception type, the
> culprit beneath it, and then the columns you actually scan by: last seen, age, a
> twenty-four hour trend sparkline, event and user counts, priority, and who owns
> it.

### B09 · two-phase load

**Screen:** `ctrl+r`, and hold while the counts and sparklines land.

> The counts and the sparklines arrive on a second request, exactly like the web
> app does it — the list paints first and fills in after.

### B10 · responsive columns

**Screen:** narrow the window, then widen it back.

> Narrow the terminal and the columns shed from the right, in the order you're
> least likely to miss them. The title never loses.

---

## Act 4 — Moving around

### B11 · cursor

**Screen:** several `j` presses, a `G`, then a `g`.

> j and k move. g and capital G jump to the ends. The viewport follows the cursor
> rather than the other way round.

---

## Act 5 — Search

### B12 · focus and type

**Screen:** `/` focuses the search bar; type a query.

> Slash focuses the search bar, and it takes any Sentry query you'd type on the
> web.

### B13 · commit

**Screen:** Enter; the stream refetches.

> Enter commits it and refetches.

### B14 · revert `[CUT]`

**Screen:** `/`, type something, Escape; the old query snaps back.

> And escape puts back whatever was there before you started typing.

---

## Act 6 — Filters

### B15 · projects

**Screen:** `P` opens the project dropdown; select one.

> Capital P opens the project selector, and it's multi-select.

### B16 · environment and date

**Screen:** `E`, Escape, then `D` and pick a period.

> E filters by environment, D by date range. Each chip prints the key that opens
> it, so the shortcut and the button are the same object — and you can click them
> if you'd rather.

---

## Act 7 — Issue detail

### B17 · open

**Screen:** Enter on an issue with a real stack trace.

> Enter opens the issue.

### B18 · the header

**Screen:** hold on the header block.

> The header is the whole triage question on one screen: status, project,
> priority, assignee, a twenty-four hour chart three rows tall, event and user
> counts, first seen, last seen — and the actions you can take, each one wearing
> the key that fires it.

### B19 · sections

**Screen:** `2` folds breadcrumbs, `2` unfolds, `z` folds all, `z` again.

> Below that, six sections — stack trace, breadcrumbs, request, tags, contexts,
> SDK. Each one prints the digit that folds it, so you read the binding off the
> screen instead of memorizing it. z folds everything at once.

### B20 · the stack trace

**Screen:** scroll through the exception section slowly.

> The stack trace opens on the frame that crashed, with source context, syntax
> highlighting, and local variables. Repeated frames collapse to a count, and
> frames outside your own code stay out of the way until you want them.

### B21 · the rest `[CUT]`

**Screen:** scroll down through breadcrumbs, tags, contexts.

> Breadcrumbs run in the order that led to the error. Tags and contexts sit in a
> key column and a value column, so a block of sixteen is still scannable.

---

## Act 8 — Triage

### B22 · resolve

**Screen:** `r`. The badge and the row change immediately; the status bar confirms
with the short ID.

> Triage is where a terminal client earns its keep. r resolves.

### B23 · the rest of the verbs

**Screen:** `u`, `b`, `m`, then Escape back to the stream and `a` from the list.

> a archives until it escalates. u unresolves, b bookmarks, m marks reviewed — and
> they all work the same whether you're in the list or in the issue.

### B24 · optimism

**Screen:** hold on a row that just changed.

> Every one of them lands on the row instantly and confirms in the status bar. If
> the request fails, the row rolls back to exactly what it was before — no
> refetch, no guessing.

### B25 · refresh `[CUT]`

**Screen:** `ctrl+r`; spinner in the status bar.

> Control-R reloads whatever you're looking at.

---

## Act 9 — The command palette

### B26 · ctrl+k

**Screen:** `ctrl+k`, type `log`, watch the results narrow.

> Control-K is the command palette. Every destination and every command, fuzzy
> matched. It's built from the same navigation and command definitions the rest of
> the app uses, so it can't drift out of date — and a command with no handler
> never appears in it.

---

## Act 10 — Explore › Logs

### B27 · navigate

**Screen:** Enter on the palette's `Logs` result.

> Which is also the fastest way to get anywhere.

### B28 · the log stream

**Screen:** hold on the logs view; `j` a few times.

> Explore, Logs. A volume chart across the window, then the stream itself — time,
> severity, project, message, colored by level. Same search bar, same filters,
> same keys.

### B29 · log detail

**Screen:** Enter opens the panel; `j` twice so it follows the cursor.

> Enter opens the detail panel — body, severity, project, and the trace ID that
> ties it back to everything else. The cursor keeps moving underneath it, so you
> can read down a stream of logs without opening and closing anything.

---

## Act 11 — Help

### B30 · the overlay

**Screen:** `?`, hold, Escape.

> Question mark lists every shortcut in the app. That overlay isn't hand-written —
> it's generated from the command catalog, so rebinding a key updates the help,
> and a command with no key simply has no row.

---

## Act 12 — Close

### B31 · quit

**Screen:** `q`, back to a bare prompt. Hold two beats on the empty terminal.

> Eight thousand lines of TypeScript, on OpenTUI and Bun. Sentry, in your
> terminal.

---

## Fidelity notes

### Why this records in Kitty and not VHS

The nav icons, org avatar, platform icons and assignee avatars all render through
`<image>`, and `useImageSupport` turns them off unless the terminal reports kitty
graphics or sixel **and** `HERDR_ENV` / `TMUX` / `STY` are unset. VHS renders
through a headless browser terminal that doesn't advertise kitty graphics, and a
Herdr pane is excluded by name. Both would produce a text-only nav rail.

So `demos/record.ts` drives a real Kitty window over its remote-control socket
instead. Run it from a normal shell, **not** from inside Herdr or tmux — the
launched Kitty inherits the environment, and `HERDR_ENV` in it would switch the
icons back off. `record.ts` refuses to start if it finds one of those set.

### Deliberately not narrated

None of these are wired up, so none of them appear:

- **Changing the sort.** `SORT_OPTIONS` exists and the filter row displays the
  current sort, but `IssueStream` holds it in a `useState` with no setter — it is
  always "Last Seen". That chip is a label, not a control.
- **Clicking the issue-detail action chips.** The filter chips are wired to
  `onPress`; resolve/archive/bookmark in the detail header are keyboard-only. B16
  says "you can click them" about the _filter_ chips — keep the mouse off the
  detail header.
- **Every nav section except Issues and Explore › Logs.** Dashboards, Monitors,
  Settings and the rest of Explore render an honest "Not implemented yet." Worth
  showing as a design decision if you want a detour, but it's off-message here.

Note that **any Issues item** — Feed, Inbox, All Views — renders the same stream.
Stay on Feed so the secondary nav never claims something it isn't doing.
