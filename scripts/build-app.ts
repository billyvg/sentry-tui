#!/usr/bin/env bun
/** Build the platform-neutral app payload loaded by the compiled runtime host. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  HOST_API_VERSION,
  HOST_MODULE_SPECIFIERS,
} from "../packages/runtime-contract/src/runtime.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "dist", "app");
const ENTRY = join(ROOT, "packages", "app", "src", "payloadEntry.tsx");

interface BunSourceMap {
  version: number;
  mappings: string;
  debugId?: string;
  [key: string]: unknown;
}

const DEBUG_ID_COMMENT = /^\/\/# debugId=([0-9a-f-]+)\r?$/gim;

/** Normalize Bun's compact debug ID to the UUID spelling Sentry sends in events. */
export function canonicalDebugId(value: string): string {
  const compact = value.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error(`Invalid debug ID: ${value}`);
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

/**
 * Register Bun's generated debug ID with the Sentry SDK before the payload runs.
 *
 * Bun writes the same ID into the JavaScript comment and source map, but a
 * comment alone never reaches an event's `debug_meta`. The standard runtime
 * registry bridges that gap. One empty generated line keeps the external map
 * aligned after prepending the registration snippet.
 */
export function registerBunDebugId(
  source: string,
  sourceMap: BunSourceMap,
): { source: string; sourceMap: BunSourceMap } {
  if (sourceMap.version !== 3 || typeof sourceMap.mappings !== "string") {
    throw new Error("App payload has an unsupported source map");
  }

  const comments = [...source.matchAll(DEBUG_ID_COMMENT)];
  if (comments.length !== 1) {
    throw new Error(`App payload must contain exactly one Bun debug ID, found ${comments.length}`);
  }

  const sourceDebugId = canonicalDebugId(comments[0]![1]!);
  const mapDebugId = canonicalDebugId(sourceMap.debugId ?? "");
  if (sourceDebugId !== mapDebugId) {
    throw new Error(`App payload debug ID ${sourceDebugId} does not match map ${mapDebugId}`);
  }

  const registration =
    "!function(){try{var e=globalThis,n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]=" +
    `${JSON.stringify(sourceDebugId)})}catch(e){}}();`;

  if (source.startsWith(`${registration}\n`)) return { source, sourceMap };
  if (source.includes("._sentryDebugIds")) {
    throw new Error("App payload contains an unknown Sentry debug ID registration");
  }

  return {
    source: `${registration}\n${source}`,
    sourceMap: { ...sourceMap, mappings: `;${sourceMap.mappings}` },
  };
}

/**
 * Modules whose identity belongs to the host.
 *
 * A second React instance makes hooks invalid, while a second OpenTUI instance
 * would not know about the renderer the host already owns. Custom specifiers
 * leave these imports unresolved in the payload and let the host supply the
 * exact module namespaces already loaded in its process.
 */
export const HOST_MODULES = new Map(Object.entries(HOST_MODULE_SPECIFIERS));

/**
 * Point external imports at Bun runtime-plugin specifiers of equal length.
 *
 * Bun's bundler preserves the original spelling of an external import even
 * when an onResolve plugin returns another path. Rewriting the exact
 * quoted specifiers after bundling keeps this explicit and testable without
 * shifting the already-generated sourcemap.
 */
export function rewriteHostModuleSpecifiers(source: string): string {
  let rewritten = source;
  for (const [dependency, hosted] of HOST_MODULES) {
    rewritten = rewritten.replaceAll(JSON.stringify(dependency), JSON.stringify(hosted));
  }
  return rewritten;
}

/** Build one immutable payload plus the manifest inspected before import. */
export async function buildAppPayload(): Promise<void> {
  const { app } = (await Bun.file(join(ROOT, "release.json")).json()) as {
    app?: string;
  };
  if (!app) throw new Error("release.json has no app version");

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: OUT_DIR,
    naming: { entry: "app.mjs", asset: "assets/[name]-[hash].[ext]" },
    target: "bun",
    format: "esm",
    // Bun's source maps do not retain identifier names. Preserve them in the
    // payload itself so Sentry does not receive functions named `a` and `b`
    // even after it maps the frame back to TypeScript.
    minify: { syntax: true, whitespace: true, identifiers: false },
    // Sentry needs the generated frame. A linked map makes Bun rewrite the
    // stack first, leaving no raw frame for Sentry to process.
    sourcemap: "external",
    external: [...HOST_MODULES.keys()],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("app payload build failed");
  }

  const output = join(OUT_DIR, "app.mjs");
  const mapOutput = `${output}.map`;
  const source = rewriteHostModuleSpecifiers(await readFile(output, "utf8"));
  const sourceMap = JSON.parse(await readFile(mapOutput, "utf8")) as BunSourceMap;
  const registered = registerBunDebugId(source, sourceMap);
  await writeFile(output, registered.source);
  await writeFile(mapOutput, `${JSON.stringify(registered.sourceMap)}\n`);

  await writeFile(
    join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ version: app, hostApiVersion: HOST_API_VERSION, entry: "app.mjs" }, null, 2)}\n`,
  );
  console.log(`App payload v${app} (host API ${HOST_API_VERSION}) written to dist/app`);
}

if (import.meta.main) await buildAppPayload();
