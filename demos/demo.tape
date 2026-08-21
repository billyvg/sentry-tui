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
  Settle 20s
  Key space
End

Meanwhile @B02
  Sleep 1200ms
  # Capital Q quits outright. Lowercase q raises an "are you sure" prompt, and
  # answering it is one more thing to mistime.
  Key shift+q
  Sleep 800ms
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
  # The refetch takes a couple of seconds; opening the palette any sooner
  # covers a list that is still empty, and the search never visibly lands.
  Sleep 3s
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
  Sleep 2200ms
  Key r
  Sleep 1600ms
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
  Sleep 2200ms
  Key j 3
  Sleep 1500ms
  Key j 3
  Sleep 1500ms
  Key j 3
  Sleep 1200ms
  Key k 4
End

Meanwhile @B09
  Key n
  Sleep 300ms
  Key e
  Sleep 300ms
  Key l
  Sleep 1300ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key y
  Sleep 1300ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key b
  Sleep 1200ms
  Key n
  Sleep 250ms
  Key e
  Sleep 250ms
  Key p
End

# Back to Seer through the palette, inside the beat so the line plays over the
# navigation rather than after it. Escape releases the composer so j scrolls the
# transcript instead of typing into it.
Meanwhile @B10
  Key ctrl+k
  Sleep 500ms
  Type `ask seer`
  Sleep 600ms
  Key enter
  Sleep 1200ms
  Key escape
  Sleep 300ms
  # Whatever is left of Seer's ~25 seconds — usually little, since the last
  # three beats have been covering it. This is what makes "fully rendered" a
  # guarantee, and inside the block the narration plays over it.
  Settle 30s
  Key j 4
  Sleep 1800ms
  Key j 4
End

# ---------------------------------------------------------------------------
# Act 4 — outro
# ---------------------------------------------------------------------------

# THE INSTALL COMMAND. Typed, never run — it is there to be copied, and running
# it would just launch the app over the top of the demo. Change it here if the
# published name changes. `npx` needs no global install, which is why the outro
# uses it over `npm install -g`.
Meanwhile @B11
  Key q
  Sleep 800ms
  Type `clear`
  Key enter
  Sleep 400ms
  Type `npx sentry-tui`
End
# Hold the still frame so viewers can copy it. The line starts during the quit,
# so the command is up for most of B11 and this adds eight more — about fifteen
# seconds of readable command. This is the one deliberate silence in the cut:
# it is there to give people time to copy, not to fill.
Sleep 8s
