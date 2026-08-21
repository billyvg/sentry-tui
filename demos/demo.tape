# sentry-tui demo — about 70 seconds, of which the last 10 are the install command.
#
# `Meanwhile @BNN … End` plays a beat's narration while running the steps inside
# it, so the screen keeps moving as the line is spoken. `Wait @BNN` is the plain
# hold, for the few beats that want a still frame.
#
# Beat text lives in narration.md. `demo:mux` fails if the tape names a beat that
# has no audio, and tape.test.ts pins the goto keys used below.
#
# Run `bun run demo:seer-prep` first — Act 3 ends on Seer.

Set Columns 160
Set Rows 44
Set FontSize 18
Set Output build/video.mp4

# No SENTRY_TUI_LATENCY here on purpose: the script claims two seconds to open,
# so the recording must not be padding the load.
Env PS1 ❯

# ---------------------------------------------------------------------------
# Act 0 — cold open
# ---------------------------------------------------------------------------

Meanwhile @B01
  Type `lynx -accept_all_cookies https://sentry.io`
  Key enter
  # sentry.io takes about five seconds to render in lynx. Waiting for it rather
  # than guessing a Sleep matters more than it looks: every key below lands in
  # the page, so if it is still loading the quit never happens and `sentry-tui`
  # gets typed into lynx instead of the shell.
  Settle 15s
  Key space
End

Meanwhile @B02
  Sleep 1200ms
  # Capital Q quits outright. Lowercase q raises an "are you sure" prompt, and
  # answering it is one more thing to mistime.
  Key shift+q
  # Lynx restores the terminal on its way out and the shell redraws behind it,
  # and anything typed into that window is eaten a character at a time — a fixed
  # 800ms produced `lear: command not found` on screen. Wait for the redraw to
  # finish, then spend a keystroke that costs nothing if it is the one that gets
  # dropped.
  Settle 5s
  Key enter
  Sleep 500ms
  Type `clear`
  Key enter
End

# ---------------------------------------------------------------------------
# Act 1 — the reveal
# ---------------------------------------------------------------------------

# The app paints about two seconds in, so the reveal lands mid-sentence.
Meanwhile @B03
  Type `sentry-tui`
  Key enter
End

Meanwhile @B04
  Sleep 2s
  Key j 4
  Sleep 1500ms
  Key k 2
End

# ---------------------------------------------------------------------------
# Act 2 — all keyboard
# ---------------------------------------------------------------------------

# n opens goto mode and prints a key inside every label; i repoints the
# secondary pane, f commits Feed.
Meanwhile @B05
  Sleep 800ms
  Key n
  Sleep 2500ms
  Key i
  Sleep 1500ms
  Key f
End

Meanwhile @B06
  Key /
  Sleep 400ms
  # A leading space, and a term the default query does not already contain:
  # `/` focuses the bar with `is:unresolved issue.priority:[high, medium]`
  # already in it and the cursor at the end, so this appends to it.
  Type ` API`
  Sleep 900ms
  Key enter
  # Wait for the refetch rather than guessing at it: opening the palette any
  # sooner covers a list that is still empty, and the search never visibly lands.
  Settle 5s
  # The palette is also how we reach Seer — goto's item key leaks into the
  # composer, which takes focus on arrival, so the question would come out as
  # "aWhich project…".
  Key ctrl+k
  Sleep 500ms
  Type `ask seer`
  Sleep 600ms
  Key enter
  Sleep 1200ms
  Type `Which project is failing the most this week?`
  Sleep 400ms
  Key enter
End

# Seer is thinking from here — about 25 seconds. The next three beats cover it.
# Escape first: the composer still holds focus and n would type into it.
Meanwhile @B07
  Key escape
  Sleep 300ms
  Key n
  Sleep 300ms
  Key i
  Sleep 300ms
  Key f
  Sleep 1600ms
  Key enter
  # The detail view fetches the event, its stacktrace and its tags. Two seconds
  # was a picture of it loading; `Settle` waits for the real thing and then
  # leaves it up long enough to look at.
  Settle 5s
  Key r
  Sleep 1800ms
  Key escape
End

# ---------------------------------------------------------------------------
# Act 3 — while Seer works
# ---------------------------------------------------------------------------

Meanwhile @B08
  Key n
  Sleep 300ms
  Key d
  Sleep 300ms
  Key a
  Sleep 1200ms
  Key enter
  # Every widget fetches its own series. Scrolling before they land is a tour of
  # skeletons, which is the opposite of the point being made.
  Settle 6s
  Key j 3
  Sleep 1800ms
  Key j 3
  Sleep 1800ms
  Key k 4
  Sleep 1200ms
  # Hand over to Act 3's first screen here rather than at the top of B09: the
  # word "Profiles" has to land on Profiles, and a goto plus a fetch is a second
  # and a half it would otherwise land in front of.
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key p
  Settle 5s
End

# Explore, one screen per beat: Profiles, Releases, Replays, Logs, Traces.
#
# Each beat opens with its screen already up and holds it while the narration
# names it, then navigates to the next one and waits. That ordering is the whole
# trick — the alternative is a beat that says "Replays" over the tail of the
# screen before it, because a goto plus a fetch takes longer than the word does.
#
# `Settle` rather than a sleep for the fetch: a fixed guess recorded four
# loading skeletons and a status bar reading "loading replays…" in an earlier
# cut, which reads as a slow app rather than a complete one.

Meanwhile @B09
  Sleep 1200ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key b
  Settle 5s
End

Meanwhile @B10
  Sleep 1200ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key y
  Settle 5s
End

Meanwhile @B11
  Sleep 1200ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key l
  Settle 5s
End

Meanwhile @B12
  Sleep 1200ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key r
  Settle 6s
End

# Traces carries the web's Visualize / Group by / Sort toolbar as a chip row
# under the filters. Shift+V opens the aggregate menu, shift+B the group-by one.
#
# Grouping is the point of the beat. With no group by the table is a page of
# spans; add one and the same endpoint answers aggregates — one row per op with
# a proportional bar — so the toolbar visibly stops being chrome and starts
# being a query. Both halves of this were driven against the real app and read
# back off the screen before they went in the tape.
Meanwhile @B13
  Sleep 1000ms
  # Visualize has no filter box — its list is eighteen fixed aggregates — so
  # this arrows: count, avg, p50, p75, p90, p95. The cursor opens on the
  # current aggregate, which is `count` on a freshly launched app.
  Key shift+v
  Sleep 800ms
  Key j 5
  Sleep 600ms
  Key enter
  # Wait for the chart to come back as p95 before touching Group by. The two
  # chips are one query being built, but seeing the first one land is what makes
  # the toolbar look like a control rather than a decoration.
  Settle 8s
  # Group By does have a filter, because its list is every attribute the org sends.
  Key shift+b
  Sleep 800ms
  Key /
  Sleep 300ms
  Type `span.op`
  Sleep 800ms
  Key enter
  Settle 10s
End

# Back to Seer through the palette, inside the beat so the line plays over the
# navigation rather than after it. Escape releases the composer so j scrolls the
# transcript instead of typing into it.
Meanwhile @B14
  Key ctrl+k
  Sleep 500ms
  Type `ask seer`
  Sleep 600ms
  Key enter
  Sleep 1200ms
  Key escape
  Sleep 300ms
  # Whatever is left of Seer's ~25 seconds — by now nothing, since Act 3 has
  # spent the better part of a minute covering it. This is what makes "fully
  # rendered" a guarantee, and inside the block the narration plays over it.
  Settle 15s
  Key j 4
  Sleep 2000ms
  Key j 4
  # The last thing on screen before the outro, so let it be read.
  Sleep 2500ms
End

# ---------------------------------------------------------------------------
# Act 4 — outro
# ---------------------------------------------------------------------------

# THE INSTALL COMMAND. Typed, never run — it is there to be copied, and running
# it would just launch the app over the top of the demo. Change it here if the
# published name changes. `npx` needs no global install, which is why the outro
# uses it over `npm install -g`.
Meanwhile @B15
  Key q
  # Same as leaving lynx: the app hands the terminal back and the shell redraws.
  Settle 4s
  Key enter
  Sleep 400ms
  Type `clear`
  Key enter
  Sleep 600ms
  # Walk the prompt down the window so the sign-off sits near the middle of the
  # frame rather than pinned to the top edge, where it reads like a stray line
  # of output. Rows is 44 and this lands the pair on rows 21 and 22 — measured,
  # not guessed, so it moves if `Set Rows` does.
  Key enter 20
  Sleep 500ms
  # A comment, so it is inert if anyone does hit return. zsh only treats `#`
  # that way with `interactivecomments`, which `lib/kitty.ts` sets on the
  # recorded shell — without it this is `command not found: #` on camera.
  Type `# use sentry.terminal now`
  Key enter
  Sleep 900ms
  Type `npx sentry-tui`
End
# Hold the still frame so viewers can copy it. The command goes up a couple of
# seconds into B15 and this adds eight more — about fifteen seconds of readable
# command. This is the one deliberate silence in the cut: it is there to give
# people time to copy, not to fill.
Sleep 8s
