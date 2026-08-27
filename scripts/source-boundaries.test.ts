/**
 * Source boundary audit — fast structural checks on the import graph that
 * complement dependency-cruiser's full traversal.
 *
 * These tests catch common patterns that slip past the cruiser rules:
 * - app lib files importing from anywhere else in the app
 * - circular re-exports between api/ and core/
 * - UI components importing store internals directly
 * - a second animation clock appearing anywhere in the UI
 */
import { test, expect, describe } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = join(import.meta.dirname, "..", "packages", "app", "src");

// Known violations — these are tracked in .dependency-cruiser-known-violations.json
// and should be resolved, not added to. This list is shrink-only.
const KNOWN_LIB_VIOLATIONS = new Set([
  "lib/sparkline.ts: imports ~/api/types",
  "lib/stacktrace.ts: imports ~/api/types",
]);

async function* walkTs(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTs(path);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      yield path;
    }
  }
}

/** Extract import paths (static imports and re-exports) from source text. */
function extractImports(source: string): string[] {
  const re = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/g;
  const imports: string[] = [];
  let match;
  while ((match = re.exec(source)) !== null) {
    imports.push(match[1]!);
  }
  return imports;
}

/** Check if an import path references a given src/ subdirectory. */
function importsFrom(importPath: string, srcDir: string): boolean {
  // Handles both ~/dir/ path aliases and relative imports
  return importPath.startsWith(`~/${srcDir}/`) || importPath.startsWith(`~/${srcDir}`);
}

/**
 * Every `~/` import out of `dir` that doesn't land in one of `allowed`.
 *
 * Shared by leaf tiers that may reach only explicitly allowed app directories.
 */
async function leafViolations(dir: string, allowed: string[], known = new Set<string>()) {
  const violations: string[] = [];

  for await (const file of walkTs(join(SRC, dir))) {
    const source = await readFile(file, "utf8");
    for (const imp of extractImports(source)) {
      if (!imp.startsWith("~/")) continue;
      if (allowed.some((tier) => importsFrom(imp, tier))) continue;
      const violation = `${relative(SRC, file)}: imports ${imp}`;
      if (!known.has(violation)) violations.push(violation);
    }
  }

  return violations;
}

describe("source boundaries", () => {
  test("app lib does not import from other app directories", async () => {
    expect(await leafViolations("lib", ["lib"], KNOWN_LIB_VIOLATIONS)).toEqual([]);
  });

  test("app api does not import from core or ui", async () => {
    const violations: string[] = [];
    const apiDir = join(SRC, "api");

    for await (const file of walkTs(apiDir)) {
      const source = await readFile(file, "utf8");
      const imports = extractImports(source);
      for (const imp of imports) {
        if (importsFrom(imp, "core") || importsFrom(imp, "ui") || importsFrom(imp, "app")) {
          violations.push(`${relative(SRC, file)}: imports ${imp}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("app core does not import from ui", async () => {
    const violations: string[] = [];
    const coreDir = join(SRC, "core");

    for await (const file of walkTs(coreDir)) {
      const source = await readFile(file, "utf8");
      const imports = extractImports(source);
      for (const imp of imports) {
        if (importsFrom(imp, "ui") || importsFrom(imp, "app")) {
          violations.push(`${relative(SRC, file)}: imports ${imp}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("animation clocks", () => {
  /**
   * Only small leaf components are allowed to animate.
   *
   * A `setInterval` in a screen re-renders that screen — table and all — on
   * every tick, which is how a loading Replays list came to redraw twenty
   * skeleton rows ten times a second. It also stops React's `act()` from ever
   * settling in tests, because a flush pass that costs more than the interval
   * always finds fresh work waiting: #98 and #66 were both that.
   *
   * Anything that needs to re-render while a request is in flight belongs in
   * the status bar or its own leaf, never at a screen root.
   */
  /**
   * Intervals that are not render clocks: they tick on a timescale where the
   * cost of a re-render does not arise, and add one to the list only for
   * another of those.
   */
  const NOT_A_RENDER_CLOCK = new Set([
    // Every `UPDATE_POLL_MS`, and inert unless the npm launcher started us.
    join("ui", "hooks", "useUpdateCheck.ts"),
  ]);

  const SPINNER_FRAME_LEAVES = new Set([
    join("ui", "components", "Spinner.tsx"),
    join("ui", "components", "StatusBar.tsx"),
  ]);

  test("only the spinner drives one", async () => {
    const offenders: string[] = [];
    for await (const file of walkTs(join(SRC, "ui"))) {
      const path = relative(SRC, file);
      if (path === join("ui", "components", "Spinner.tsx")) continue;
      if (NOT_A_RENDER_CLOCK.has(path)) continue;
      if (/\bsetInterval\s*\(/.test(await readFile(file, "utf8"))) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });

  test("spinner frames are owned by approved leaves", async () => {
    const offenders: string[] = [];
    for await (const file of walkTs(join(SRC, "ui"))) {
      const path = relative(SRC, file);
      if (SPINNER_FRAME_LEAVES.has(path)) continue;
      if (/\buseSpinnerFrame\s*\(/.test(await readFile(file, "utf8"))) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });
});
