#!/usr/bin/env bun
/**
 * `bun run demo:tts` — synthesize each narration beat and measure it.
 *
 * Output is one mp3 per beat plus `build/durations.json`, which is what lets the
 * tape hold each action for exactly as long as its line takes to say.
 *
 * Synthesis is cached on a hash of the text, model and voice, so re-running
 * after an edit only re-renders the beats that actually changed — which matters,
 * because settling the pacing takes several passes and each one otherwise costs
 * the whole script.
 *
 *   bun run demo:tts                  # render every beat
 *   bun run demo:tts --check          # synthesize one short phrase and stop
 *   bun run demo:tts --measure-only   # measure audio you recorded yourself
 */

import { file, write } from "bun";
import { mkdir } from "node:fs/promises";

import { probeDuration } from "./lib/capture.ts";
import { parseNarration } from "./lib/narration.ts";
import { AUDIO_DIR, BUILD_DIR, DURATIONS_PATH, NARRATION_PATH } from "./lib/paths.ts";

interface Backend {
  label: string;
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  /**
   * OpenAI's free-text delivery steering. OpenRouter's `/audio/speech` schema
   * has no such field, so sending it there is at best ignored.
   */
  supportsInstructions: boolean;
  /**
   * Playback rate. Not every model honours it — OpenAI TTS and Azure do, and
   * the rest ignore it — but the default read is slow enough at ~115 wpm that
   * the knob is worth having.
   */
  speed: number;
}

/**
 * Pick a provider from whichever key is present.
 *
 * OpenAI first because `gpt-4o-mini-tts` takes an `instructions` string, and
 * being able to direct the read is worth more than anything else on offer.
 * OpenRouter is the fallback, and its OpenAI-hosted TTS models are commonly not
 * available on a plain account — `openai/gpt-4o-mini-tts` answers "does not
 * exist" — so the default there is a model that is.
 */
function resolveBackend(): Backend {
  const openai = process.env["OPENAI_API_KEY"]?.trim();
  const openrouter = process.env["OPENROUTER_API_KEY"]?.trim();

  const model = process.env["DEMO_TTS_MODEL"]?.trim();
  const voice = process.env["DEMO_TTS_VOICE"]?.trim();
  const speed = Number(process.env["DEMO_TTS_SPEED"] ?? 1);

  if (openai) {
    return {
      label: "OpenAI",
      url: "https://api.openai.com/v1/audio/speech",
      apiKey: openai,
      model: model ?? "gpt-4o-mini-tts",
      voice: voice ?? "ash",
      supportsInstructions: true,
      speed,
    };
  }

  if (openrouter) {
    return {
      label: "OpenRouter",
      url: "https://openrouter.ai/api/v1/audio/speech",
      apiKey: openrouter,
      // Azure's MAI-Voice-2 reads long-form narration well and honours `speed`.
      // Its voices are Azure names, not OpenAI ones — "alloy" is rejected.
      model: model ?? "microsoft/mai-voice-2",
      voice: voice ?? "en-US-Harper:MAI-Voice-2",
      supportsInstructions: false,
      speed,
    };
  }

  console.error(
    "No TTS key found. Set one of these — export it, or put it in demos/.env\n" +
      "(gitignored; Bun loads it automatically):\n\n" +
      "  OPENAI_API_KEY=sk-…          gpt-4o-mini-tts, and `instructions` works\n" +
      "  OPENROUTER_API_KEY=sk-or-…   microsoft/mai-voice-2 by default\n\n" +
      "Override with DEMO_TTS_MODEL / DEMO_TTS_VOICE / DEMO_TTS_SPEED.\n" +
      "Check a key works without rendering the whole script:\n" +
      "  bun run demo:tts --check",
  );
  process.exit(1);
}

/**
 * Steer the read. Only OpenAI takes this; see {@link Backend.supportsInstructions}.
 */
const INSTRUCTIONS =
  process.env["DEMO_TTS_INSTRUCTIONS"] ??
  "Confident and conversational, like a developer demoing something they built and like. " +
    "Measured pace, dry rather than enthusiastic. Do not rush the ends of sentences.";

const measureOnly = Bun.argv.includes("--measure-only");
// Resolved lazily: measuring audio you recorded needs no provider, and
// `resolveBackend` exits when it can't find a key.
const backend = measureOnly ? null : resolveBackend();

/** One request. Returns the mp3 bytes, or throws with the provider's own words. */
async function synthesize(text: string): Promise<ArrayBuffer> {
  if (!backend) throw new Error("No TTS backend resolved.");
  const response = await fetch(backend.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: backend.model,
      voice: backend.voice,
      input: text,
      response_format: "mp3",
      speed: backend.speed,
      ...(backend.supportsInstructions ? { instructions: INSTRUCTIONS } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${backend.label} returned ${response.status} for model "${backend.model}", ` +
        `voice "${backend.voice}":\n  ${await response.text()}`,
    );
  }
  return response.arrayBuffer();
}

if (backend) {
  console.log(
    `${backend.label}: ${backend.model} / ${backend.voice}` +
      (backend.speed === 1 ? "" : ` at ${backend.speed}×`),
  );
}

// ---------------------------------------------------------------------------
// --check: one phrase, so a key or a model id can be tested for a fraction of
// a cent instead of a whole script.
// ---------------------------------------------------------------------------

if (Bun.argv.includes("--check")) {
  await mkdir(BUILD_DIR, { recursive: true });
  const sample = `${BUILD_DIR}/tts-check.mp3`;
  await write(sample, await synthesize("Terminal UIs are so back. Sentry, in your terminal."));
  const seconds = await probeDuration(sample);
  console.log(`\nOK — ${seconds.toFixed(1)}s written to ${sample}`);
  console.log(`Listen with:  afplay ${sample}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

interface CacheEntry {
  hash: string;
  seconds: number;
  /**
   * Where the file came from. Audio marked `external` is never re-synthesized
   * or overwritten — a recording of your own voice is not something the script
   * gets to decide is stale.
   */
  source?: "synth" | "external";
}

/** Formats a Mac records into, all of which ffmpeg can turn into mp3. */
const IMPORTABLE = [".mp3", ".m4a", ".wav", ".aiff", ".aif", ".caf", ".flac"];

/** Convert a recording to the mp3 `demo:mux` expects. */
async function toMp3(from: string, to: string): Promise<void> {
  const proc = Bun.spawn(
    ["ffmpeg", "-v", "error", "-i", from, "-c:a", "libmp3lame", "-q:a", "2", "-y", to],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) {
    throw new Error(`Could not convert ${from}: ${await new Response(proc.stderr).text()}`);
  }
}

const beats = parseNarration(await file(NARRATION_PATH).text());
if (beats.length === 0) throw new Error(`No beats found in ${NARRATION_PATH}`);

await mkdir(AUDIO_DIR, { recursive: true });

const cachePath = `${BUILD_DIR}/tts-cache.json`;
const cacheFile = file(cachePath);
const cache: Record<string, CacheEntry> = (await cacheFile.exists())
  ? ((await cacheFile.json()) as Record<string, CacheEntry>)
  : {};

// The provider is part of the key: the same words in a different voice are a
// different recording, and a different length.
const hashOf = (text: string) =>
  new Bun.CryptoHasher("sha256")
    .update(`${backend?.url} ${backend?.model} ${backend?.voice} ${backend?.speed} ${text}`)
    .digest("hex");

/**
 * Audio you supplied for this beat, if any.
 *
 * Anything in `build/audio` that isn't an mp3 gets converted to one, because
 * `demo:mux` reads `BNN.mp3` and a Mac records `.m4a` — QuickTime, Voice Memos
 * and `afrecord` all do.
 */
async function importExternal(beatId: string): Promise<string | null> {
  const mp3 = `${AUDIO_DIR}/${beatId}.mp3`;
  for (const extension of IMPORTABLE) {
    const candidate = `${AUDIO_DIR}/${beatId}${extension}`;
    if (!(await file(candidate).exists())) continue;
    if (extension !== ".mp3") await toMp3(candidate, mp3);
    return extension;
  }
  return null;
}

/**
 * Comfortable narration sits around 140–160 words per minute. Outside this a
 * read is either rushed or draggy, and a synthesizer will happily produce
 * either — MAI-Voice-2 races short lines especially, so the average hides it.
 */
const WPM_MIN = 130;
const WPM_MAX = 175;

const wpm = (text: string, seconds: number) => (text.split(/\s+/).length / seconds) * 60;

const durations: Record<string, number> = {};
let rendered = 0;
const missing: string[] = [];

for (const beat of beats) {
  const path = `${AUDIO_DIR}/${beat.id}.mp3`;
  const hash = hashOf(beat.text);
  const cached = cache[beat.id];

  // Audio you recorded wins over anything this script could produce, and it is
  // never overwritten — only re-measured, in case you replaced the take.
  const external = await importExternal(beat.id);
  const isYours = cached?.source === "external" || (measureOnly && external !== null);

  if (isYours && external !== null) {
    const seconds = await probeDuration(path);
    durations[beat.id] = seconds;
    cache[beat.id] = { hash: "external", seconds, source: "external" };
    const note = external === ".mp3" ? "" : ` (converted from ${external})`;
    console.log(`  ${beat.id} ${seconds.toFixed(1)}s — yours${note} — ${beat.title}`);
    continue;
  }

  if (measureOnly) {
    missing.push(beat.id);
    console.log(`  ${beat.id} — MISSING — ${beat.title}`);
    continue;
  }

  if (cached?.hash === hash && (await file(path).exists())) {
    durations[beat.id] = cached.seconds;
    console.log(
      `  ${beat.id} ${cached.seconds.toFixed(1)}s ${pace(beat.text, cached.seconds)} (cached) — ${beat.title}`,
    );
    continue;
  }

  await write(path, await synthesize(beat.text));
  const seconds = await probeDuration(path);
  durations[beat.id] = seconds;
  cache[beat.id] = { hash, seconds, source: "synth" };
  rendered++;
  console.log(`  ${beat.id} ${seconds.toFixed(1)}s ${pace(beat.text, seconds)} — ${beat.title}`);
}

await write(DURATIONS_PATH, `${JSON.stringify(durations, null, 2)}\n`);
await write(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

const total = Object.values(durations).reduce((sum, seconds) => sum + seconds, 0);
const optional = beats.filter((beat) => beat.optional);
const withoutOptional = total - optional.reduce((sum, beat) => sum + (durations[beat.id] ?? 0), 0);

const measured = Object.keys(durations).length;
console.log(
  measureOnly
    ? `\n${measured} of ${beats.length} beats measured.`
    : `\n${beats.length} beats, ${rendered} newly rendered.`,
);
console.log(
  `Narration runs ${formatMinutes(total)} — ${formatMinutes(withoutOptional)} without the ${optional.length} [CUT] beats.`,
);
console.log(`Wrote ${DURATIONS_PATH}`);

// Per-beat flags above are informative on their own; this only fires when the
// script *as a whole* is out of band, because that is the one problem a single
// setting fixes. A couple of quick short lines among slow long ones is normal.
const overall = Math.round(wpm(beats.map((beat) => beat.text).join(" "), total));
if (overall > WPM_MAX || overall < WPM_MIN) {
  const suggestion = Math.max(0.5, Math.min(2, (backend?.speed ?? 1) * (150 / overall)));
  console.warn(
    `\nThe whole script reads at ${overall} wpm, outside the comfortable ${WPM_MIN}–${WPM_MAX} band.\n` +
      `It will feel ${overall > WPM_MAX ? "rushed and run short" : "draggy and run long"}. Re-render with:\n` +
      `  DEMO_TTS_SPEED=${suggestion.toFixed(2)} bun run demo:tts`,
  );
} else {
  console.log(`Reads at ${overall} wpm overall.`);
}

if (missing.length > 0) {
  // A beat with no audio is not a warning: `demo:mux` refuses to run, and
  // `demo:record` would hold it for the fallback instead of the real line.
  console.error(
    `\n${missing.length} beat${missing.length === 1 ? "" : "s"} have no audio:\n` +
      `  ${missing.join(", ")}\n\n` +
      `Drop a recording per beat into ${AUDIO_DIR} named after it — B07.mp3, B07.m4a,\n` +
      `.wav, .aiff and .caf all work, and anything that isn't mp3 gets converted.\n` +
      `Or render the rest with a provider: bun run demo:tts`,
  );
  process.exit(1);
}

/** `152wpm`, flagged when the read is outside a comfortable band. */
function pace(text: string, seconds: number): string {
  const rate = Math.round(wpm(text, seconds));
  const flag = rate > WPM_MAX ? " ⚡fast" : rate < WPM_MIN ? " 🐢slow" : "";
  return `${rate}wpm${flag}`;
}

function formatMinutes(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
