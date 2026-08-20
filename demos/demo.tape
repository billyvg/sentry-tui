# sentry-tui demo
#
# Wait @BNN holds for exactly as long as beat BNN's narration audio, so the
# picture is cut to the voice. Sleep is for beats of pure timing — a keystroke
# landing, a request returning — that no line covers.
#
# Beat text lives in narration.md. Keep the two in step: `demo:mux` fails loudly
# if the tape waits on a beat that has no audio.

Set Columns 160
Set Rows 44
Set FontSize 18
Set Output build/video.mp4

# The harness puts a `sentry-tui` shim first on PATH, so the demo types the real
# command while running from source — see writeShim in demos/lib/paths.ts.
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
# Act 7 — issue detail
# ---------------------------------------------------------------------------

Key enter
Sleep 1200ms
Wait @B17

Wait @B18

Key 2
Sleep 700ms
Key 2
Sleep 700ms
Key z
Sleep 700ms
Key z
Wait @B19

Key j 8
Wait @B20

# ---------------------------------------------------------------------------
# Act 8 — triage
# ---------------------------------------------------------------------------

Key r
Sleep 800ms
Wait @B22

Key u
Sleep 700ms
Key b
Sleep 700ms
Key m
Sleep 700ms
Key escape
Sleep 600ms
Key a
Wait @B23

Wait @B24

# ---------------------------------------------------------------------------
# Act 9 — the command palette
# ---------------------------------------------------------------------------

Key ctrl+k
Sleep 700ms
Type `log`
Wait @B26

# ---------------------------------------------------------------------------
# Act 10 — Explore › Logs
# ---------------------------------------------------------------------------

Key enter
Sleep 1500ms
Wait @B27

Key j 3
Wait @B28

Key enter
Sleep 900ms
Key j
Sleep 900ms
Key j
Wait @B29

Key escape
Sleep 400ms

# ---------------------------------------------------------------------------
# Act 11 — help
# ---------------------------------------------------------------------------

Key ?
Sleep 700ms
Wait @B30

Key escape
Sleep 500ms

# ---------------------------------------------------------------------------
# Act 12 — close
# ---------------------------------------------------------------------------

Key q
Sleep 600ms
Type `clear`
Key enter
Wait @B31
