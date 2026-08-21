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

Type `lynx -accept_all_cookies https://sentry.io`
Key enter
Sleep 3s

Meanwhile @B01
  Sleep 2s
  Key space
End

Meanwhile @B02
  Sleep 1s
  Key q
  Sleep 300ms
  Key y
  Sleep 700ms
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
  Type `is:unresolved`
  Sleep 1200ms
  Key enter
  Sleep 1200ms
  Key ctrl+k
  Sleep 700ms
  Type `rep`
End

Meanwhile @B07
  Key escape
  Sleep 500ms
  Key enter
  Sleep 2500ms
  Key r
  Sleep 1800ms
  Key escape
End

# ---------------------------------------------------------------------------
# Act 3 — how much is here
# ---------------------------------------------------------------------------

# A montage: Logs, Replays, Releases, Profiles, then Seer. Explore's goto keys
# are l, y, b and p; Seer is s then a.
Meanwhile @B08
  Key n
  Sleep 400ms
  Key e
  Sleep 300ms
  Key l
  Sleep 1600ms
  Key n
  Sleep 300ms
  Key e
  Sleep 300ms
  Key y
  Sleep 1600ms
  Key n
  Sleep 300ms
  Key e
  Sleep 300ms
  Key b
  Sleep 1400ms
  Key n
  Sleep 300ms
  Key e
  Sleep 300ms
  Key p
  Sleep 1400ms
  Key n
  Sleep 300ms
  Key s
  Sleep 300ms
  Key a
End

# The Seer composer takes focus on arrival, so the question types straight in.
Meanwhile @B09
  Sleep 900ms
  Type `Which project is failing the most this week?`
  Sleep 900ms
  Key enter
End

# ---------------------------------------------------------------------------
# Act 4 — outro
# ---------------------------------------------------------------------------

# Escape releases the Seer composer before q can reach the app.
Key escape
Sleep 400ms
Key q
Sleep 800ms
Type `clear`
Key enter
Sleep 400ms

# THE INSTALL COMMAND. Typed, never run — it is there to be copied, and running
# it inside the demo would just reinstall over the top. Change it here if the
# published name ever changes.
Type `npm install -g sentry-tui`
Wait @B10
# Hold the still frame so viewers can copy it: B10's line plus this is ~10s.
Sleep 6s
