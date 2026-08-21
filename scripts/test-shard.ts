#!/usr/bin/env bun
/**
 * Runs one slice of the test suite, so CI can spread it across runners.
 *
 * `bun test` has no `--shard` of its own, so the split happens here: discover
 * every test file the bare command would have run, pack them into balanced
 * shards, and hand one shard's paths back to `bun test`. The packing is by
 * file size — a rough stand-in for runtime, but one that needs no committed
 * timings to keep up to date.
 *
 * Every shard is derived from the same discovery pass, so the union is always
 * the whole suite; `scripts/test-shard.test.ts` holds that to it.
 *
 *   bun run test:shard 1 4     # first of four shards
 */
import { Glob } from "bun";
import { join } from "node:path";

/** How many shards CI splits the suite into. The workflow matrices restate it. */
export const CI_SHARD_TOTAL = 4;

/** Matches the files `bun test` picks up on its own. */
const TEST_FILE_GLOB = "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}";

/** Directories `bun test` skips, and so must discovery. */
const IGNORED_PREFIXES = ["node_modules/", "dist/", "coverage/", ".git/"];

const ROOT = join(import.meta.dirname, "..");

/** A test file and the number standing in for how long it takes to run. */
export type WeightedFile = { path: string; weight: number };

/**
 * Lists every test file in the repository, as repo-relative paths, sorted.
 */
export function discoverTestFiles(root: string = ROOT): string[] {
  return [...new Glob(TEST_FILE_GLOB).scanSync({ cwd: root, onlyFiles: true })]
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .sort();
}

/**
 * Weighs test files by their size on disk.
 */
export function weighTestFiles(paths: string[], root: string = ROOT): WeightedFile[] {
  return paths.map((path) => ({ path, weight: Bun.file(join(root, path)).size }));
}

/**
 * Splits files into `total` shards of roughly equal weight.
 *
 * Greedy: heaviest file first, into whichever shard is lightest so far. Ties
 * break on path, so the same input always produces the same split — a shard
 * number means the same thing on every runner and every rerun.
 */
export function planShards(files: WeightedFile[], total: number): string[][] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard total must be a positive integer, got ${total}`);
  }

  const shards = Array.from({ length: total }, () => ({ weight: 0, paths: [] as string[] }));
  const heaviestFirst = [...files].sort(
    (a, b) => b.weight - a.weight || a.path.localeCompare(b.path),
  );

  for (const file of heaviestFirst) {
    let lightest = shards[0]!;
    for (const shard of shards) {
      if (shard.weight < lightest.weight) lightest = shard;
    }
    lightest.weight += file.weight;
    lightest.paths.push(file.path);
  }

  return shards.map((shard) => shard.paths.sort());
}

/**
 * Returns the files belonging to shard `index` (1-based) of `total`.
 */
export function filesForShard(index: number, total: number, root: string = ROOT): string[] {
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard index must be between 1 and ${total}, got ${index}`);
  }
  return planShards(weighTestFiles(discoverTestFiles(root), root), total)[index - 1]!;
}

/**
 * Parses the CLI arguments and runs the requested shard.
 */
async function main(argv: string[]): Promise<number> {
  const [rawIndex, rawTotal] = argv;
  if (!rawIndex || !rawTotal) {
    console.error("usage: bun run test:shard <index> <total>   (index is 1-based)");
    return 2;
  }

  const index = Number(rawIndex);
  const total = Number(rawTotal);
  const files = filesForShard(index, total);

  console.log(`shard ${index}/${total} — ${files.length} test files`);
  if (files.length === 0) {
    console.log("nothing to run");
    return 0;
  }

  const proc = Bun.spawn(["bun", "test", ...files], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
