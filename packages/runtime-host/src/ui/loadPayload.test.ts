import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOST_API_VERSION, HOST_MODULE_SPECIFIERS } from "@sentry-tui/runtime-contract/runtime";
import { loadAppPayload, readPayloadManifest } from "@sentry-tui/runtime-host/ui/loadPayload";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payloadFiles({
  version = "1.2.3",
  hostApiVersion = HOST_API_VERSION,
  source,
}: {
  version?: string;
  hostApiVersion?: number;
  source?: string;
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-runtime-payload-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify({ version, hostApiVersion, entry: "app.mjs" })}\n`,
  );
  writeFileSync(
    join(dir, "app.mjs"),
    source ??
      `export const payload = ${JSON.stringify({ version, hostApiVersion })};\n` +
        `export function PayloadApp() { return null; }\n`,
  );
  return join(dir, "app.mjs");
}

describe("runtime app payloads", () => {
  test("loads a payload implementing the current host contract", async () => {
    const loaded = await loadAppPayload(payloadFiles());
    expect(loaded.metadata).toEqual({ version: "1.2.3", hostApiVersion: HOST_API_VERSION });
    expect(typeof loaded.App).toBe("function");
    expect(loaded.entryPath).toEndWith("app.mjs");
  });

  test("rejects an incompatible payload before executing it", async () => {
    const marker = `__sentry_tui_payload_${Date.now()}`;
    const entry = payloadFiles({
      hostApiVersion: HOST_API_VERSION + 1,
      source: `globalThis[${JSON.stringify(marker)}] = true; export const payload = {}; export function PayloadApp() {}`,
    });

    await expect(readPayloadManifest(entry)).rejects.toThrow(/needs host API/);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  test("uses the host's React instance through its virtual module", async () => {
    const metadata = { version: "1.2.3", hostApiVersion: HOST_API_VERSION };
    const loaded = await loadAppPayload(
      payloadFiles({
        source:
          `import { createElement } from ${JSON.stringify(HOST_MODULE_SPECIFIERS.react)};\n` +
          `export const payload = ${JSON.stringify(metadata)};\n` +
          `export function PayloadApp() { return createElement("text", null, "loaded"); }\n`,
      }),
    );

    const element = loaded.App({} as never) as { props?: { children?: string } };
    expect(element.props?.children).toBe("loaded");
  });
});
