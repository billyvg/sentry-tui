#!/usr/bin/env bun
/**
 * `bun run demo:pace` — put every beat on the same speaking rate.
 *
 * `demo:tts` runs this as its last stage, so the only reason to call it
 * directly is to re-pace audio you already have: it needs no API key, touches
 * no provider, and reads whatever is in `build/audio` — synthesized or recorded
 * in your own voice.
 *
 *   bun run demo:pace                 # correct onto the default rate
 *   bun run demo:pace --target 4.6    # a brisker script
 *   bun run demo:pace --dry-run       # measure and report, write nothing
 */

import { file, write } from "bun";

import { parseNarration } from "./lib/narration.ts";
import {
  countSyllables,
  formatPacingReport,
  paceAll,
  profileVoice,
  TARGET_ARTICULATION,
  TARGET_OVERALL,
  textFingerprint,
} from "./lib/pace.ts";
import { AUDIO_DIR, BUILD_DIR, DURATIONS_PATH, NARRATION_PATH, PACED_DIR } from "./lib/paths.ts";

const argument = (name: string): string | undefined => {
  const at = Bun.argv.indexOf(name);
  return at === -1 ? undefined : Bun.argv[at + 1];
};

const target = Number(argument("--target") ?? TARGET_ARTICULATION);
if (!(target > 0)) throw new Error(`--target needs a positive rate, got "${argument("--target")}"`);
const overallTarget = Number(argument("--overall") ?? TARGET_OVERALL);
if (!(overallTarget > 0 && overallTarget <= target)) {
  throw new Error(`--overall needs a positive rate no higher than --target (${target})`);
}

const beats = parseNarration(await file(NARRATION_PATH).text());
const dryRun = Bun.argv.includes("--dry-run");

/**
 * Beats whose audio was made from different words.
 *
 * Pacing an edited line against its old take is worse than not pacing it: the
 * syllable count and the recording disagree, so the correction is computed from
 * a rate that was never spoken. Only `demo:tts` can fix it, so this says so
 * rather than quietly producing a confident wrong answer.
 */
const cacheFile = file(`${BUILD_DIR}/tts-cache.json`);
const cache = (await cacheFile.exists())
  ? ((await cacheFile.json()) as Record<string, { text?: string }>)
  : {};
const stale = beats.filter((beat) => {
  const recorded = cache[beat.id]?.text;
  return recorded !== undefined && recorded !== textFingerprint(beat.text);
});
if (stale.length > 0) {
  console.warn(
    `${stale.length} beat${stale.length === 1 ? " has" : "s have"} been edited since the ` +
      `audio was made: ${stale.map((beat) => beat.id).join(", ")}\n` +
      `Their rates below are measured against words that were never spoken. ` +
      `Run \`bun run demo:tts\` to re-render them.\n`,
  );
}

if (dryRun) {
  console.log(`Rates as recorded (target ${target.toFixed(2)} syl/s):\n`);
  for (const beat of beats) {
    const source = `${AUDIO_DIR}/${beat.id}.mp3`;
    if (!(await file(source).exists())) {
      console.log(`  ${beat.id} — no audio — ${beat.title}`);
      continue;
    }
    const { voicedSeconds, totalSeconds } = await profileVoice(source);
    const rate = countSyllables(beat.text) / voicedSeconds;
    console.log(
      `  ${beat.id} ${totalSeconds.toFixed(1)}s  ${rate.toFixed(2)} syl/s speaking  ` +
        `needs ${(target / rate).toFixed(2)}× — ${beat.title}`,
    );
  }
  process.exit(0);
}

const paced = await paceAll(beats, {
  audioDir: AUDIO_DIR,
  pacedDir: PACED_DIR,
  target,
  overallTarget,
});

if (paced.length === 0) {
  throw new Error(`No beat audio in ${AUDIO_DIR} — run \`bun run demo:tts\` first.`);
}

console.log(
  `Paced ${paced.length} beats onto ${target.toFixed(2)} syllables of speech per second, ` +
    `${overallTarget.toFixed(2)} including pauses:\n`,
);
console.log(formatPacingReport(paced));

const durations = Object.fromEntries(paced.map((beat) => [beat.id, beat.seconds]));
await write(DURATIONS_PATH, `${JSON.stringify(durations, null, 2)}\n`);

const total = paced.reduce((sum, beat) => sum + beat.seconds, 0);
const speechRates = paced.map((beat) => beat.pacedRate);
const overallRates = paced.map((beat) => beat.overallRate);
console.log(
  `\nNarration runs ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}, ` +
    `${Math.min(...speechRates).toFixed(2)}–${Math.max(...speechRates).toFixed(2)} syl/s speaking, ` +
    `${Math.min(...overallRates).toFixed(2)}–${Math.max(...overallRates).toFixed(2)} overall.`,
);
console.log(`Wrote ${DURATIONS_PATH}`);

const missing = beats.filter((beat) => !paced.some((done) => done.id === beat.id));
if (missing.length > 0) {
  console.warn(
    `\n${missing.length} beat${missing.length === 1 ? "" : "s"} had no audio and were skipped: ` +
      `${missing.map((beat) => beat.id).join(", ")}`,
  );
}

console.log("\nRe-record and re-mux to pick this up:  bun run demo:record && bun run demo:mux");
