/**
 * Guards the sharded test run against the two ways it can quietly lose tests.
 *
 * A shard split is only safe if the shards add back up to the whole suite, and
 * if CI actually asks for every shard the planner made. Neither is visible in a
 * green run: a file that falls out of the split, or a matrix that stops one
 * short, just looks like a faster suite.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { CI_SHARD_TOTAL, discoverTestFiles, planShards, weighTestFiles } from "./test-shard.ts";
import { runTestShards } from "./test-parallel.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => Bun.file(join(ROOT, path)).text();

const SHARDED_WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml"];

describe("test discovery", () => {
  test("finds the suite, and nothing from node_modules or dist", () => {
    const files = discoverTestFiles();

    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("scripts/test-shard.test.ts");
    expect(files).toContain("test/app.test.tsx");
    expect(files.some((f) => f.startsWith("packages/"))).toBe(true);
    expect(files.some((f) => f.startsWith("node_modules/") || f.startsWith("dist/"))).toBe(false);
  });
});

describe("shard planning", () => {
  const files = weighTestFiles(discoverTestFiles());

  for (const total of [1, 2, CI_SHARD_TOTAL, 8]) {
    test(`${total} shards partition the suite exactly once each`, () => {
      const shards = planShards(files, total);
      const assigned = shards.flat();

      expect(shards).toHaveLength(total);
      expect(new Set(assigned).size).toBe(assigned.length);
      expect(assigned.sort()).toEqual(files.map((f) => f.path).sort());
    });
  }

  test("no shard sits idle while another carries the suite", () => {
    const weights = planShards(files, CI_SHARD_TOTAL).map((shard) =>
      shard.reduce((sum, path) => sum + files.find((f) => f.path === path)!.weight, 0),
    );
    const even = weights.reduce((a, b) => a + b, 0) / CI_SHARD_TOTAL;

    expect(Math.min(...weights)).toBeGreaterThan(0);
    expect(Math.max(...weights)).toBeLessThan(even * 1.5);
  });

  test("the same input always splits the same way", () => {
    expect(planShards(files, CI_SHARD_TOTAL)).toEqual(planShards(files, CI_SHARD_TOTAL));
  });

  test("a nonsensical shard total is refused rather than silently skipped", () => {
    expect(() => planShards(files, 0)).toThrow();
    expect(() => planShards(files, 1.5)).toThrow();
  });
});

describe("CI matrices", () => {
  for (const path of SHARDED_WORKFLOWS) {
    test(`${path} asks for every shard`, async () => {
      const workflow = await read(path);
      const shards = [...workflow.matchAll(/^ {8}shard: \[([^\]]+)\]$/gm)];

      expect(shards).toHaveLength(1);
      const listed = shards[0]![1]!.split(",").map((n) => Number(n.trim()));
      expect(listed).toEqual(Array.from({ length: CI_SHARD_TOTAL }, (_, i) => i + 1));
      expect(workflow).toContain(`bun run test:shard "$SHARD" "${CI_SHARD_TOTAL}"`);
    });
  }
});

describe("local parallel runner", () => {
  test("launches every shard before it waits", async () => {
    const launched: string[][] = [];
    const release: Array<(code: number) => void> = [];
    const commands = [
      ["bun", "test", "one"],
      ["bun", "test", "two"],
      ["bun", "test", "three"],
    ];

    const result = runTestShards(commands, (command) => {
      launched.push(command);
      return {
        exited: new Promise((resolve) => release.push(resolve)),
      };
    });

    expect(launched).toEqual(commands);
    for (const resolve of release) resolve(0);
    expect(await result).toBe(0);
  });

  test("propagates a shard failure after every shard settles", async () => {
    const exitCodes = [0, 7, 0];
    let launched = 0;
    const result = await runTestShards(
      exitCodes.map((_, index) => ["shard", String(index + 1)]),
      () => ({ exited: Promise.resolve(exitCodes[launched++]!) }),
    );

    expect(launched).toBe(exitCodes.length);
    expect(result).toBe(7);
  });

  test("bun run check uses the process-isolated local runner", async () => {
    const packageJson = (await Bun.file(join(ROOT, "package.json")).json()) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:parallel"]).toBe("bun run ./scripts/test-parallel.ts");
    expect(packageJson.scripts.check).toEndWith("bun run test:parallel");
  });
});
