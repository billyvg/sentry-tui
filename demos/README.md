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
its remote-control socket instead, and records that window.

The tape syntax is still VHS's, because it reads well and it's familiar.

## Why it records a window, not the screen

`screencapture -v -l<windowid>` records one window. The obvious alternative —
`ffmpeg -f avfoundation` plus a crop rect — is worse in three separate ways, all
of which were tried first:

- It records what the **compositor** draws, so anything overlapping the window
  ends up in the video. The crop is a fixed rect, so an occluded window yields a
  perfectly framed recording of whatever was on top of it. That looks exactly
  like a coordinate bug and isn't one.
- It needs the window's position, and the obvious way to get that (System Events)
  needs Accessibility permission granted to **`osascript`** — not to your
  terminal — so it fails with "osascript is not allowed assistive access" no
  matter what you tick in System Settings.
- The position isn't stable between runs anyway, so it can't be cached.

Recording by window id needs none of it: no crop, no coordinate space, no
Accessibility, and nothing can obscure the picture. The window is opened with
`hide_window_decorations=yes`, which also removes the title bar macOS parks the
stop-recording control in.

## Prerequisites

- **kitty** (`brew install kitty`) — the renderer.
- **ffmpeg** (`brew install ffmpeg`) — muxing and probing.
- **Screen Recording** permission for the terminal you run this from
  (System Settings › Privacy & Security › Screen Recording). This is the only
  permission needed.
- A TTS key for the narration — `OPENAI_API_KEY` **or** `OPENROUTER_API_KEY`.
  Put it in `demos/.env` (gitignored); Bun loads that automatically.

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

This started as a workaround: `bun build --compile` used to leave `src/assets/**`
out of the bundle, so every `<image>` resolved to a path that wasn't there and
each icon silently rendered as nothing. #56 fixed that — the art is embedded now
— but the shim stays, because running from source needs no build step and cannot
drift from the working tree. It costs nothing on screen: the typed command is
`sentry-tui` either way.

Drop it and put `dist` on PATH instead if you'd rather record the real artifact —
but check the icons in the first frames if you do.

## Recording

```bash
bun run demo:seer-prep   # pick the org, prove Seer answers for it
bun run demo:tts         # synthesize narration, measure each beat
bun run demo:record      # replay the tape into kitty → build/video.mov
bun run demo:mux         # lay the audio on → build/demo.mp4

bun run demo             # tts + record + mux
```

### Preparing the org

Act 12 asks Seer a question, and Seer only answers for orgs where the Explorer
agent is enabled — so the demo's default org has to be one of those.

```bash
bun run demo:seer-prep --list            # which orgs can you pick from
bun run demo:seer-prep --org acme-prod   # make it the default, then probe
bun run demo:seer-prep --no-probe        # set/report only, no Seer run
bun run demo:seer-prep --query "…"       # probe with your own question
```

`--org` writes the stored default (the same one the app falls back to), then asks
Seer a real question and prints the answer, so you can judge whether it's worth
putting on camera before spending a take. A run costs a Seer query; `--no-probe`
skips it. `SENTRY_ORG` still overrides for a single run.

The org matters for the rest of the demo too — one with no matching issues records
an honest but very dull "No issues match this search."

## Narration voices

`demo:tts` takes whichever key it finds, OpenAI first:

| Key                  | Default model           | Default voice              | `instructions`? |
| -------------------- | ----------------------- | -------------------------- | --------------- |
| `OPENAI_API_KEY`     | `gpt-4o-mini-tts`       | `ash`                      | yes             |
| `OPENROUTER_API_KEY` | `microsoft/mai-voice-2` | `en-US-Harper:MAI-Voice-2` | no              |

Test a key for a fraction of a cent instead of rendering the whole script:

```bash
bun run demo:tts --check          # one phrase → build/tts-check.mp3
afplay demos/build/tts-check.mp3
```

No key at all? See [Recording the narration yourself](#recording-the-narration-yourself).

Override any of it with `DEMO_TTS_MODEL`, `DEMO_TTS_VOICE`, `DEMO_TTS_SPEED` and
(OpenAI only) `DEMO_TTS_INSTRUCTIONS`.

### Recording the narration yourself

The best-sounding option, and the pipeline takes it directly. Record one file per
beat into `build/audio/`, named after the beat — `B01.mp3`, `B02.mp3`, … — then:

```bash
bun run demo:tts --measure-only
```

That needs no API key and synthesizes nothing. It measures each file, writes
`durations.json`, and lists any beat still missing audio (exiting non-zero, since
a gap would leave `demo:mux` refusing to run and `demo:record` holding a fallback
pause instead of your line).

`.m4a`, `.wav`, `.aiff`, `.caf` and `.flac` are accepted as well as `.mp3` — a Mac
records `.m4a` from QuickTime and Voice Memos — and anything that isn't already an
mp3 is converted for you.

**Your audio is never overwritten.** Once a beat has been measured from a file you
supplied, a later `bun run demo:tts` re-measures it and moves on, so you can
record the beats you care about and let a provider fill in the rest:

```
B01 2.5s — yours — lynx renders sentry.io
B02 4.0s — yours (converted from .m4a) — out of lynx
B03 3.1s — the app launches
```

To hand a beat back to the synthesizer, delete its mp3 and its entry in
`build/tts-cache.json`.

A useful order: render everything with a provider first to settle the pacing,
then re-record the beats you want in your own voice and run `--measure-only`
again. The tape re-times itself around whatever the files actually are.

### Slowing down one beat

`DEMO_TTS_SPEED` moves the whole script. For a single line — a punchline that
needs air, a dense sentence that needs room — add a `**Speed:**` stage direction
to the beat:

```markdown
### B11 · install

**Screen:** a bare prompt with `npx sentry-tui` typed and not run.
**Speed:** 0.85

> This is the next generation of user interfaces. Go see for yourself.
```

It's a stage direction, so it is never spoken, and it joins the cache key — only
that beat re-renders when you change it.

The rate is **not** linear in this model, so measure rather than predict. For the
sign-off above: `1.0` → 6.3s / 199 wpm, `0.92` → 7.5s / 168, `0.85` → 7.9s / 159,
`0.82` → 10.3s / 122. `demo:tts` prints the wpm and marks the beat `@0.85×`.

Remember a slower beat is a longer video. That's free at the end of the cut —
the install frame just holds longer — but a beat inside the Seer cover window
(B07–B09) changes how long the agent has to answer.

### On OpenRouter

OpenRouter exposes an OpenAI-shaped `/audio/speech`, with two differences that
matter:

- **The OpenAI TTS models usually aren't available.** `openai/gpt-4o-mini-tts`
  and its dated variants answer `Model … does not exist` on a plain account, so
  the default here is `microsoft/mai-voice-2`, which works. `fish-audio/s2.1-pro`
  also works if you want a second option.
- **Voices are provider-specific.** Azure wants its own names
  (`en-US-Harper:MAI-Voice-2`); passing OpenAI's `alloy` gets a 400.

There is no `instructions` field in OpenRouter's schema, so delivery can't be
steered there — `DEMO_TTS_SPEED` is the only pacing control. MAI-Voice-2 reads at
roughly 115 wpm unaided, which is slower than the script assumes; **1.15× lands
near 145 wpm** and sounds natural.

Voice choice changes every beat's length, so it is part of the cache key —
switching providers re-renders the script rather than reusing stale timings.

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

## Keeping the screen moving

`Wait @BNN` holds a still frame for the length of a beat. Used for every beat
that produces a slideshow: one static screen per sentence.

`Meanwhile` plays the beat _while_ running the steps inside it:

```
Meanwhile @B05
  Sleep 800ms
  Key n
  Sleep 2500ms
  Key i
  Sleep 1500ms
  Key f
End
```

The block lasts whichever is longer — the beat's audio or its own sleeps — so a
line that outruns its actions still holds to the end, and actions that outrun the
line still finish. Almost every beat in `demo.tape` is a `Meanwhile`; `Wait` is
left for the outro, where a still frame is the point.

## Editing the script

Beats are `### BNN · title` headings in `narration.md`; the `>` blockquote under
each is what gets spoken. Ordinary paragraphs are stage directions and are never
read aloud. A beat tagged `[CUT]` is optional — `demo:tts` reports the runtime
with and without them.

If you add a beat, add its `Wait @BNN` to the tape. `demo:mux` fails loudly if
the tape waits on a beat with no audio, rather than quietly leaving a gap.

### Seer holds the keyboard

The Seer composer takes focus the moment you arrive, which is what lets the tape
type a question straight away — but it also means every other key goes into the
text box. `n` does not open goto mode there, it types an "n". The tape presses
escape to drop into the transcript before anything else, and any step you add
after Act 12 has to do the same.

## Known sharp edge

Kitty's `send-key` reports success even when nothing was delivered — it can't
know whether the program's keyboard mode accepted the key. So a tape step that
silently does nothing is a real failure mode, and **the only true test of a
recording is watching it.** `demo:record` says so when it finishes, and it isn't
being polite.
