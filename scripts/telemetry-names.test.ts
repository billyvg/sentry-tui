/**
 * Telemetry names stay one vocabulary.
 *
 * `TelemetryName` in runtime-contract is the type-level half of this:
 * it makes the compiler reject anything without three dotted segments. What it
 * cannot see is casing, the shape of a segment, or whether a name invented a
 * sixth namespace nobody documented — a template literal type accepts
 * `Api.Request.Failed` as readily as the real thing.
 *
 * So this is the lint on top. It reads the source rather than importing it,
 * because the names only exist at call sites: nothing collects them at runtime,
 * and a run with telemetry off never even evaluates the SDK.
 *
 * The namespace list below is the point of the whole check. Adding one is a
 * deliberate act — a new top-level thing the app reports about — so it fails
 * here until someone adds it here and to the table in `AGENTS.md`.
 */

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SOURCE_ROOTS = [
  join(import.meta.dirname, "..", "packages", "app", "src"),
  join(import.meta.dirname, "..", "packages", "runtime-host", "src"),
];

/** The top-level subsystems telemetry names may describe. See `AGENTS.md`. */
const NAMESPACES = new Set([
  "app", // the process and the session it runs
  "api", // requests to Sentry and what came back
  "auth", // credentials, tokens, signing in
  "nav", // moving between screens
  "ui", // rendering and what the user did
]);

/** `<namespace>.<subject>.<event>`, lowercase, `snake_case` within a segment. */
const NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2}$/;

/** The name argument of `log("info", …)` / `log("warn", …)` / `log("error", …)`. */
const LOG_CALL = /\blog\(\s*"(?:info|warn|error)"\s*,\s*([^,)]+)/g;

/** The name argument of `countMetric(…)` — the calls, not the declaration. */
const METRIC_CALL = /(?<!function )\bcountMetric\(\s*([^,)]+)/g;

/**
 * A `source:` property given a literal. Only read in files that import
 * `reportError` — `source` is an ordinary field name elsewhere in the app
 * (saved queries have one) and those are not telemetry names.
 */
const SOURCE_PROPERTY = /\bsource:\s*("[^"]*")/g;

async function* walkTs(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTs(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

interface Found {
  /** `src`-relative file and the text as written, for a failure worth reading. */
  where: string;
  literal: string;
}

/** Every telemetry name written down in app or host source, as written. */
async function collect(): Promise<Found[]> {
  const found: Found[] = [];

  for (const root of SOURCE_ROOTS) {
    for await (const file of walkTs(root)) {
      const source = await readFile(file, "utf8");
      const where = relative(join(import.meta.dirname, ".."), file);

      const patterns = [LOG_CALL, METRIC_CALL];
      if (source.includes("reportError")) patterns.push(SOURCE_PROPERTY);

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
          found.push({ where, literal: m[1]!.trim() });
        }
      }
    }
  }

  return found;
}

describe("telemetry names", () => {
  test("there are some to check", async () => {
    // A regex that silently stops matching would otherwise pass every test
    // below by finding nothing at all.
    expect((await collect()).length).toBeGreaterThan(8);
  });

  test("every name is a plain string, not built at the call site", async () => {
    // An interpolated name is a name per route, per screen, per org: it makes
    // the log unfilterable and the metric unaggregatable. Whatever varies is
    // an attribute.
    const interpolated = (await collect())
      .filter(({ literal }) => !/^"[^"]*"$/.test(literal))
      .map(({ where, literal }) => `${where}: ${literal}`);

    expect(interpolated).toEqual([]);
  });

  test("every name is <namespace>.<subject>.<event>", async () => {
    const malformed = (await collect())
      .filter(({ literal }) => /^"[^"]*"$/.test(literal))
      .filter(({ literal }) => !NAME.test(literal.slice(1, -1)))
      .map(({ where, literal }) => `${where}: ${literal}`);

    expect(malformed).toEqual([]);
  });

  test("every namespace is one of the documented ones", async () => {
    const unknown = (await collect())
      .filter(({ literal }) => /^"[^"]*"$/.test(literal))
      .filter(({ literal }) => NAME.test(literal.slice(1, -1)))
      .filter(({ literal }) => !NAMESPACES.has(literal.slice(1).split(".")[0]!))
      .map(({ where, literal }) => `${where}: ${literal}`);

    expect(unknown).toEqual([]);
  });
});
