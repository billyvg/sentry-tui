#!/usr/bin/env bun
/**
 * Build a compiled single-file binary via `bun build --compile`.
 *
 * Pin x64 to baseline targets — Bun's default x64 runtime needs AVX2 and
 * SIGILLs on older CPUs and VMs. This catches that at build time.
 */
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const ENTRY = join(ROOT, "src/main.tsx");
const OUTPUT = join(DIST, "sentry-tui");

await mkdir(DIST, { recursive: true });

console.log("Building compiled binary…");

const platform = process.platform;
const arch = process.arch;

// On x64 Linux, use baseline target to avoid AVX2 requirement.
const target = arch === "x64" && platform === "linux" ? "bun-linux-x64-baseline" : undefined;

const args = ["bun", "build", "--compile", ENTRY, "--outfile", OUTPUT];
if (target) {
  args.push("--target", target);
}

await $`${args}`;

console.log(`Binary written to ${OUTPUT}`);
