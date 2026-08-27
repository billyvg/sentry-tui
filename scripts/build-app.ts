#!/usr/bin/env bun
/** Build the platform-neutral app payload loaded by the compiled runtime host. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HOST_API_VERSION, HOST_MODULE_SPECIFIERS } from "../src/app/runtimeContract.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "dist", "app");
const ENTRY = join(ROOT, "src", "ui", "runtime", "payloadEntry.tsx");

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
  const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as { version?: string };
  if (!version) throw new Error("package.json has no version");

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: OUT_DIR,
    naming: { entry: "app.mjs", asset: "assets/[name]-[hash].[ext]" },
    target: "bun",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    external: [...HOST_MODULES.keys()],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("app payload build failed");
  }

  const output = join(OUT_DIR, "app.mjs");
  await writeFile(output, rewriteHostModuleSpecifiers(await readFile(output, "utf8")));

  await writeFile(
    join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ version, hostApiVersion: HOST_API_VERSION, entry: "app.mjs" }, null, 2)}\n`,
  );
  console.log(`App payload v${version} (host API ${HOST_API_VERSION}) written to dist/app`);
}

if (import.meta.main) await buildAppPayload();
