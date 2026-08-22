#!/usr/bin/env bun
/**
 * Build a compiled single-file binary via `bun build --compile`.
 *
 * With no arguments it builds for the machine it runs on, into
 * `dist/sentry-tui`. Release CI passes `--target` on each native runner:
 *
 *   bun run ./scripts/build-bin.ts --target darwin-arm64 --outfile dist/bin/darwin-arm64/sentry-tui
 *
 * x64 targets are pinned to Bun's baseline runtime — the default one needs AVX2
 * and SIGILLs on older CPUs and on VMs that mask it off. See `release-targets.ts`.
 *
 * Cross-compiling is deliberately not attempted: `bun build --compile` has to
 * resolve `@opentui/core-<platform>` for the target, and `bun install` skips
 * packages whose `os`/`cpu` don't match the host, so each target is built on its
 * own runner.
 */
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { BINARY_NAME, findTarget, hostTarget, RELEASE_TARGETS } from "./release-targets.ts";

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "src/main.tsx");

/** Read `--name value` out of argv. */
function parseFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

const requested = parseFlag("target");
const target = requested ? findTarget(requested) : hostTarget();

if (requested && !target) {
  console.error(
    `Unknown target "${requested}". Known targets: ${RELEASE_TARGETS.map((t) => t.key).join(", ")}`,
  );
  process.exit(1);
}

if (target && target.key !== `${process.platform}-${process.arch}`) {
  console.error(
    `Refusing to build ${target.key} on ${process.platform}-${process.arch}: ` +
      `the target's @opentui/core native package cannot be installed here.`,
  );
  process.exit(1);
}

// A named target writes to the per-target layout `build-npm.ts` reads from; a
// plain host build keeps the familiar `dist/sentry-tui`.
const output =
  parseFlag("outfile") ??
  (requested && target
    ? join(ROOT, "dist", "bin", target.key, BINARY_NAME)
    : join(ROOT, "dist", BINARY_NAME));

await mkdir(dirname(output), { recursive: true });

console.log(`Building compiled binary${target ? ` for ${target.key}` : ""}…`);

// `--sourcemap` is load-bearing, not a debug convenience: without it every
// frame in a crash report reads `/$bunfs/root/sentry-tui` at some line in the
// bundle, and the report is useless. With it, Bun embeds the map and stack
// traces come back with real `src/…` paths and line numbers — which is also
// why nothing needs uploading at release time. Costs a couple of MB.
const args = ["bun", "build", "--compile", "--sourcemap", ENTRY, "--outfile", output];
if (target) {
  args.push("--target", target.bunTarget);
}

// Measured on darwin-arm64: 70.20MB -> 68.37MB raw, 24.26MB -> 24.07MB gzipped.
// The compressed win is small because minified JS has less redundancy for gzip
// to exploit, but it is a win in both directions, so there is nothing to trade off.
args.push("--minify");

// OpenTUI picks its native library through `process.env.OPENTUI_LIBC`, a runtime
// check the bundler cannot see through, so it embeds the glibc *and* musl copies
// of `libopentui` — 20MB each on Linux. The musl branch can never be taken here:
// `bun build --compile` bases every Linux binary on a glibc-linked runtime
// (interpreter `/lib64/ld-linux-x86-64.so.2`), so on a musl-only system the
// executable fails to start long before any of our code runs. Dropping the copy
// that cannot load takes each Linux binary from ~147MB to ~127MB.
//
// Supporting Alpine means adding musl entries to `RELEASE_TARGETS` and building
// them on a musl runner — not shipping a second library glibc builds ignore.
args.push("--external", "@opentui/core-*-musl");

await $`${args}`;

console.log(`Binary written to ${output}`);
