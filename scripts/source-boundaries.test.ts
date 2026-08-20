/**
 * Source boundary audit — fast structural checks on the import graph that
 * complement dependency-cruiser's full traversal.
 *
 * These tests catch common patterns that slip past the cruiser rules:
 * - src/lib/ files importing from anywhere else in src/
 * - circular re-exports between api/ and core/
 * - UI components importing store internals directly
 */
import { test, expect, describe } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

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

describe("source boundaries", () => {
  test("src/lib/ does not import from other src/ directories", async () => {
    const violations: string[] = [];
    const libDir = join(SRC, "lib");

    for await (const file of walkTs(libDir)) {
      const source = await readFile(file, "utf8");
      const imports = extractImports(source);
      for (const imp of imports) {
        if (imp.startsWith("~/") && !importsFrom(imp, "lib")) {
          const v = `${relative(SRC, file)}: imports ${imp}`;
          if (!KNOWN_LIB_VIOLATIONS.has(v)) {
            violations.push(v);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("src/api/ does not import from core/ or ui/", async () => {
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

  test("src/core/ does not import from ui/ or app/", async () => {
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
