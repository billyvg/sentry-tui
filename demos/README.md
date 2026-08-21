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
bun run demo:tts         # synthesize narration, pace it, measure each beat
bun run demo:pace        # re-pace existing audio — no API key, no synthesis
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

### Pace: every beat reads at the same speed

A synthesizer's `speed` is a request, not a rate. Asking one model for the same
speed across this script produced a cold open at 3.5 syllables a second and the
line after it at 4.3, then a 5.3 in the middle — heard back to back, that sounds
like a slow, laggy first sentence followed by a different, faster narrator. Per
beat `Speed:` overrides made it worse: fixing one line moved the discontinuity to
its neighbour.

So pace is measured and corrected instead, as the last stage of `demo:tts`, and
it holds **two** rates rather than one:

| Target                |      | What it controls                                                  |
| --------------------- | ---- | ----------------------------------------------------------------- |
| `TARGET_ARTICULATION` | 4.35 | syllables per second of speech — how fast the mouth moves         |
| `TARGET_OVERALL`      | 3.60 | syllables per second including pauses — how fast the line arrives |

Two, because one knob cannot hold both and a listener hears both. Correcting only
the articulation left a beat the synthesizer ran together in a single breath —
0.16s of pause in 3.5 seconds — sitting next to one that paused for a fifth of
its length. Same mouth speed to within 2%; 210 words a minute against 118. The
gap between the two targets is the share of a beat spent not talking, about 17%,
which is ordinary for narration.

Each beat is then cut at its silences and rebuilt:

1. Count the syllables the line should take to say.
2. Measure the take: seconds of voice, and the length of every pause in it.
3. Scale the pauses toward the budget the overall rate implies — together, in
   proportion to how the read placed them, so the longest pause stays the
   longest.
4. `atempo` the speech to whatever articulation makes the total land on the
   overall rate.

Pauses move first because silence never sounds resampled and speech does, but
they only move so far: growing a 0.08s breath fourfold is a stutter, not a pause,
so the ceiling is 2.2× and anything left over goes to the speech — within ±12% of
the articulation target. A line read in one breath comes out slightly slower
rather than punctuated with pauses it never had, which is what a person does with
the same sentence.

```
B01 3.8s  4.81 → 3.99 syl/s @0.82×  overall 3.62 (pauses 2.20×)  172wpm — lynx renders sentry.io
B04 4.7s  3.46 → 4.35 syl/s @1.26×  overall 3.60 (pauses 0.55×)  166wpm — speed
B09 4.7s  4.01 → 4.34 syl/s @1.09×  overall 3.59 (pauses 0.80×)  115wpm — the rest of Explore
```

**Words per minute is not the target, and shouldn't be.** It still varies in that
table — 115 to 178 — because "Logs, replays, releases, profiles" packs 1.8
syllables into every word and "just like in the web app" packs 1.1. Equalising
wpm would make the first line articulate half again as fast as the second, which
is the inconsistency you can actually hear. Syllables are what the mouth does; if
a beat still reads long, the lever is the writing.

`bun run demo:pace` runs the stage on its own — no key, no synthesis, reading
whatever is in `build/audio`, so it works on your own recordings too.
`--dry-run` reports the rates and writes nothing; `--target` and `--overall` move
the two rates. Correction is capped at 0.7–1.55×: past that the resampling is
audible, and the real fix is a re-render or a shorter line. A clamped beat says
so, and so does a beat whose audio predates an edit to its line — that pair
disagreeing is how you get a confident correction computed from words nobody
spoke.

**One beat that should sit apart** — a punchline that needs air — takes an
`**Emphasis:**` stage direction, which moves both rates together:

```markdown
### B11 · install

**Screen:** a bare prompt with `npx sentry-tui` typed and not run.
**Emphasis:** 0.9

> This is the next generation of user interfaces. Go see for yourself.
```

Use it sparingly. It is the thing that made the old cut sound spliced.

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
steered there.

**Leave `DEMO_TTS_SPEED` unset.** Pace is corrected after synthesis (see
[Pace](#pace-every-beat-reads-at-the-same-speed)), so the provider only has to
produce a clean read — and a request that lands 20% off the target is corrected
back, while a request that lands 40% off is a beat the correction has to clamp.
The default 1.0 is closest to the target for both backends here.

Voice choice changes every beat's length, so it is part of the cache key —
switching providers re-renders the script rather than reusing stale timings.

## How the timing works

The video is cut to the voice rather than the other way round:

1. `demo:tts` renders each beat's blockquote to `build/audio/BNN.mp3`.
2. The pace stage rebuilds each one at the script's speaking rate — speech and
   pauses both — writes `build/audio/paced/BNN.mp3`, and measures those into
   `build/durations.json`.
3. `Wait @BNN` in the tape holds for exactly that long.
4. `demo:mux` walks the same timeline and places each beat's audio at the offset
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

## Letting a screen land

Every screen in the app fetches. A fixed `Sleep` after a navigation is a bet on
how long that takes, and it is a bet the recording loses in the worst possible
way: the Explore montage in an earlier cut visited Logs, Replays, Releases and
Profiles on 1.3-second sleeps and captured four loading skeletons and a status
bar reading "loading replays…". Nothing was broken. It just looked like a slow
app rather than a complete one.

`Settle` is the fix, and it works inside a `Meanwhile` so the line keeps playing
over the wait:

```
  Key l
  Settle 6s
```

It polls the screen and returns once it has been unchanged for a moment, so the
hold is "until the rows are actually there", plus that stability window as
dwell — the marinating time a viewer needs to register what they are looking at.
The argument is only the cap for a screen that never settles.

Two costs, both handled. A `Settle` can't be predicted, so `demo:record` budgets
the recorder for every one of them running to its maximum — the recorder's limit
has to be set before the first keystroke, and a limit that assumed nothing ever
waits would cut the take off part way through. That leaves a stretch of still
frame at the end of the capture, which `demo:mux` trims: it cuts at the end of
the last beat plus whatever the tape holds for afterwards, so the file is as long
as the demo rather than as long as the budget.

## Keeping the audio gapless

A beat's block runs for `max(line, actions)`, so any beat whose keystrokes take
longer than its narration ends in silence. Three things keep that down — the cut
is currently 3.4s of incidental silence in 79s, plus the install hold:

**Put the sleeps inside a beat.** A top-level `Sleep` between two `Meanwhile`
blocks is silence by construction — nothing is speaking over it. Fold the
navigation into the beat it belongs to and the line plays across it. `Settle`
works inside a block too, so even waiting on the agent happens under narration.

**Don't close a gap by slowing the line.** That was what the old per-beat
`Speed:` overrides did, and an inconsistent read is far more noticeable than a
second of quiet — especially between two beats that play back to back. Close it
from the picture instead, or leave it: a montage that holds each screen long
enough to be read is worth the silence at the end of the beat.

**Trim the dwells.** Most action gaps are a `Sleep` that was generous when it was
written. Shortening them tightens the cut and closes the gap from the other side.

`bun run demo:tts` prints the per-beat wpm and the overall rate, which is where
to look after any edit.

The install frame is the one deliberate silence: the command is on screen for
about fifteen seconds so people can copy it, and that is the point of it.

### The synthesizer is not deterministic

The same text at the same speed varies a lot between renders — one beat measured
3.0s on one pass and 2.7s on the next, another 4.2s then 6.4s. Pacing removes
most of that: the correction is computed from the take in hand, so a slow render
and a fast one land on the same rate and within a few percent of the same length.
The tape re-times itself from `durations.json` every run regardless, so the video
always matches whatever the audio turned out to be.

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
