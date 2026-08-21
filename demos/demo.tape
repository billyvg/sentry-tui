# sentry-tui demo
#
# Wait @BNN holds for exactly as long as beat BNN's narration audio, so the
# picture is cut to the voice. Sleep is for beats of pure timing — a keystroke
# landing, a request returning — that no line covers.
#
# Beat text lives in narration.md. Keep the two in step: `demo:mux` fails loudly
# if the tape waits on a beat that has no audio.
#
# Navigation uses goto mode (`n`) rather than tab-and-cursor: two keystrokes,
# and the keys are printed on screen as they're pressed. Those keys are derived
# from the nav labels at runtime — tape.test.ts pins the ones used here so a
# rename breaks the suite rather than the take.
#
# Run `bun run demo:seer-prep` first: Act 12 needs an org with Seer enabled.

Set Columns 160
Set Rows 44
Set FontSize 18
Set Output build/video.mp4

# The harness puts a `sentry-tui` shim first on PATH — see writeShim.
Env PS1 ❯
# Slow the first paint enough that the skeleton is actually on screen.
Env SENTRY_TUI_LATENCY 900

# ---------------------------------------------------------------------------
# Act 0 — cold open
# ---------------------------------------------------------------------------

Type `lynx -accept_all_cookies https://sentry.io`
Key enter
Sleep 4s
Wait @B01

Key space
Sleep 1s
Key space
Wait @B02

Key q
Sleep 300ms
Key y
Sleep 800ms
Type `clear`
Key enter
Sleep 500ms
Wait @B03

# ---------------------------------------------------------------------------
# Act 1 — first run
# ---------------------------------------------------------------------------

Type `sentry-tui --help`
Key enter
Sleep 1s
Wait @B04

Type `clear && SENTRY_TUI_CONFIG_DIR=$(mktemp -d) sentry-tui`
Key enter
Sleep 2s
Type `n`
Key enter
Sleep 1s
Wait @B05

# ---------------------------------------------------------------------------
# Act 2 — first paint
# ---------------------------------------------------------------------------

Type `clear && sentry-tui`
Key enter
Sleep 400ms
Wait @B06

Key tab
Sleep 1s
Key tab
Wait @B07

# ---------------------------------------------------------------------------
# Act 3 — the issue stream
# ---------------------------------------------------------------------------

Wait @B08

Key ctrl+r
Sleep 400ms
Wait @B09

Wait @B10

# ---------------------------------------------------------------------------
# Act 4 — moving around
# ---------------------------------------------------------------------------

Key j 5
Sleep 600ms
Key shift+g
Sleep 800ms
Key g
Wait @B11

# ---------------------------------------------------------------------------
# Act 5 — search
# ---------------------------------------------------------------------------

Key /
Sleep 400ms
Type `is:unresolved`
Wait @B12

Key enter
Sleep 1s
Wait @B13

# ---------------------------------------------------------------------------
# Act 6 — filters
# ---------------------------------------------------------------------------

Key shift+p
Sleep 800ms
Key j
Key enter
Sleep 800ms
Wait @B15

Key shift+e
Sleep 1s
Key escape
Sleep 400ms
Key shift+d
Sleep 800ms
Key j
Key enter
Sleep 800ms
Wait @B16

# ---------------------------------------------------------------------------
# Act 7 — issue views, via goto mode
# ---------------------------------------------------------------------------

# n opens goto mode and prints a key in every label; i points the secondary
# pane at Issues and stays in the mode; b commits Inbox and leaves it.
Key n
Sleep 1200ms
Key i
Sleep 900ms
Key b
Sleep 1500ms
Wait @B17

Key n
Sleep 700ms
Key i
Sleep 500ms
Key v
Sleep 1500ms
Wait @B18

# ---------------------------------------------------------------------------
# Act 8 — issue detail
# ---------------------------------------------------------------------------

# Back to Feed before opening an issue — Inbox and All Views are different lists.
Key n
Sleep 600ms
Key i
Sleep 400ms
Key f
Sleep 1800ms
Key enter
Sleep 1200ms
Wait @B19

Wait @B20

Key 2
Sleep 700ms
Key 2
Sleep 700ms
Key z
Sleep 700ms
Key z
Wait @B21

Key j 8
Wait @B22

Wait @B23

# ---------------------------------------------------------------------------
# Act 9 — triage
# ---------------------------------------------------------------------------

Key r
Sleep 800ms
Wait @B24

Key u
Sleep 700ms
Key b
Sleep 700ms
Key m
Sleep 700ms
Key escape
Sleep 600ms
Key a
Wait @B25

Wait @B26

# ---------------------------------------------------------------------------
# Act 10 — the command palette
# ---------------------------------------------------------------------------

Key ctrl+k
Sleep 700ms
Type `log`
Wait @B28

# ---------------------------------------------------------------------------
# Act 11 — Explore › Logs
# ---------------------------------------------------------------------------

Key enter
Sleep 2s
Key j 3
Wait @B29

Key enter
Sleep 900ms
Key j
Sleep 900ms
Key j
Wait @B30

Key escape
Sleep 400ms

# ---------------------------------------------------------------------------
# Act 12 — Seer
# ---------------------------------------------------------------------------

# n → s (Seer) → a (Ask Seer). The composer takes focus on arrival, so the
# question can be typed straight away.
Key n
Sleep 900ms
Key s
Sleep 700ms
Key a
Sleep 1800ms
Type `Which of my projects is failing the most this week, and why?`
Wait @B31

Key enter
Sleep 6s
Wait @B32

Key escape
Sleep 800ms
Key i
Sleep 800ms
Wait @B33

Key escape
Sleep 500ms

# ---------------------------------------------------------------------------
# Act 13 — help
# ---------------------------------------------------------------------------

Key ?
Sleep 700ms
Wait @B34

Key escape
Sleep 500ms

# ---------------------------------------------------------------------------
# Act 14 — close
# ---------------------------------------------------------------------------

Key q
Sleep 600ms
Type `clear`
Key enter
Wait @B35
