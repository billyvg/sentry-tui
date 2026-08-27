#!/usr/bin/env bun
/**
 * Runs every test shard concurrently in process isolation.
 *
 * CI already gives each shard its own runner. This is the local equivalent:
 * separate Bun processes avoid the suite's module-global test state while
 * allowing one process's render waits to overlap another's work.
 */
import { join } from "node:path";

import { CI_SHARD_TOTAL, filesForShard } from "./test-shard.ts";

const ROOT = join(import.meta.dirname, "..");

/** The small part of `Bun.Subprocess` the orchestrator waits on. */
export interface TestShardProcess {
  exited: Promise<number>;
}

/** Injectable process launcher used by the orchestrator and its unit tests. */
export type TestShardSpawner = (command: string[]) => TestShardProcess;

/** Build one compact-output Bun test command for every planned shard. */
export function parallelTestCommands(total = CI_SHARD_TOTAL): string[][] {
  return Array.from({ length: total }, (_, index) => [
    process.execPath,
    "test",
    "--reporter=dots",
    ...filesForShard(index + 1, total),
  ]);
}

/** Launch every command before waiting, and fail if any shard fails. */
export async function runTestShards(
  commands: readonly string[][],
  spawn: TestShardSpawner,
): Promise<number> {
  const processes = commands.map((command) => spawn(command));
  const exitCodes = await Promise.all(processes.map((process) => process.exited));
  return exitCodes.find((code) => code !== 0) ?? 0;
}

/** Launch a test process whose output shares the calling terminal. */
function spawnTestShard(command: string[]): TestShardProcess {
  return Bun.spawn(command, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
}

/** Run all locally planned shards. */
async function main(): Promise<number> {
  const commands = parallelTestCommands();
  console.log(`running ${commands.length} test shards in parallel`);
  return runTestShards(commands, spawnTestShard);
}

if (import.meta.main) process.exit(await main());
