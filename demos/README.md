# demos

Scripted, narrated screen recordings of sentry-tui.

`narration.md` is the script. `demo.tape` is the choreography. Everything else
turns the two into an mp4.

## Why not VHS

VHS renders its own headless terminal, which doesn't advertise kitty graphics.
`useImageSupport` requires kitty graphics or sixel — **and** no multiplexer —
before the app draws a single `<image>`, so under VHS the nav icons, org avatar,
platform icons and assignee avatars all silently fall back to text. That's a
visible chunk of the app's polish, so the harness drives a real Kitty window over
its remote-control socket instead and captures the screen with ffmpeg.

The tape syntax is still VHS's, because it reads well and it's familiar.

## Prerequisites

- **kitty** (`brew install kitty`) — the renderer.
- **ffmpeg** (`brew install ffmpeg`) — capture and mux.
- **Screen Recording** permission for the terminal you run this from
  (System Settings › Privacy & Security › Screen Recording).
- **Accessibility** permission for the same terminal, so the window can be framed
  precisely. Optional — without it the whole screen is recorded instead.
- `OPENAI_API_KEY`, for the narration. Put it in `demos/.env` (gitignored); Bun
  loads that automatically.

**Run all of this from a plain terminal window**, not inside Herdr or tmux. The
recorded kitty inherits the environment, and `HERDR_ENV`/`TMUX`/`STY` in it would
turn the icons back off — which is the whole reason this harness exists. Every
entry point refuses to start if it finds one set. If you genuinely need to launch
from inside a multiplexer, `env -u HERDR_ENV -u TMUX -u STY bun run demo:record`
is a real fix rather than a bypass: the recorded window then doesn't inherit the
variable either.

### The app runs from source, not from `dist`

The tape types `sentry-tui`, but that resolves to a shim the harness writes
(`writeShim` in `lib/paths.ts`) which execs `bun run src/main.tsx`.

That is deliberate. `bun build --compile` bundles the code and nothing else, so
`src/assets/**` is simply absent at runtime and every `<image>` resolves to a path
that doesn't exist — no nav icons, no platform icons, no assignee avatars. They
fail silently: the layout still reserves the cells, so the binary looks _almost_
right, which is worse. Only the org avatar survives, because it's fetched over
HTTP rather than read off disk.

So `dist/sentry-tui` can't be used for a demo whose entire point is the icons. If
the binary learns to embed its assets, this shim can go.

## Recording

```bash
bun run demo:calibrate   # once per machine / display — writes geometry.json
bun run demo:tts         # synthesize narration, measure each beat
bun run demo:record      # replay the tape into kitty, capture to build/video.mp4
bun run demo:mux         # lay the audio on → build/demo.mp4

bun run demo             # tts + record + mux
```

## How the timing works

The video is cut to the voice rather than the other way round:

1. `demo:tts` renders each beat's blockquote to `build/audio/BNN.mp3` and
   `ffprobe`s it into `build/durations.json`.
2. `Wait @BNN` in the tape holds for exactly that long.
3. `demo:mux` walks the same timeline and places each beat's audio at the offset
   its action actually happens at — so a `Sleep` between two `Wait`s becomes
   silence, and nothing downstream slides.

Re-record one line of narration and only that beat's timing moves. Synthesis is
cached on a hash of the text, so iterating on pacing is cheap.

## Editing the script

Beats are `### BNN · title` headings in `narration.md`; the `>` blockquote under
each is what gets spoken. Ordinary paragraphs are stage directions and are never
read aloud. A beat tagged `[CUT]` is optional — `demo:tts` reports the runtime
with and without them.

If you add a beat, add its `Wait @BNN` to the tape. `demo:mux` fails loudly if
the tape waits on a beat with no audio, rather than quietly leaving a gap.

## Known sharp edge

Kitty's `send-key` reports success even when nothing was delivered — it can't
know whether the program's keyboard mode accepted the key. So a tape step that
silently does nothing is a real failure mode, and **the only true test of a
recording is watching it.** `demo:record` says so when it finishes, and it isn't
being polite.
