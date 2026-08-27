import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as OpenTuiCore from "@opentui/core";
import * as OpenTuiReact from "@opentui/react";
import * as OpenTuiJsxDevRuntime from "@opentui/react/jsx-dev-runtime";
import * as OpenTuiJsxRuntime from "@opentui/react/jsx-runtime";
import * as React from "react";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import * as ReactJsxRuntime from "react/jsx-runtime";

import * as Config from "~/api/config";
import {
  HOST_API_VERSION,
  HOST_MODULE_SPECIFIERS,
  type AppPayloadManifest,
  type AppPayloadMetadata,
} from "~/app/runtimeContract";
import * as Telemetry from "~/telemetry/index";
import type { PayloadAppProps } from "~/ui/runtime/payloadEntry";

type PayloadComponent = (props: PayloadAppProps) => React.ReactNode;

export interface LoadedAppPayload {
  App: PayloadComponent;
  metadata: AppPayloadMetadata;
  /** Immutable source, used to discard a payload if its first render fails. */
  entryPath: string;
}

interface AppPayloadModule {
  PayloadApp?: unknown;
  payload?: unknown;
}

const HOST_MODULES = new Map<string, Record<string, unknown>>([
  [HOST_MODULE_SPECIFIERS.react, React],
  [HOST_MODULE_SPECIFIERS["react/jsx-runtime"], ReactJsxRuntime],
  [HOST_MODULE_SPECIFIERS["react/jsx-dev-runtime"], ReactJsxDevRuntime],
  [HOST_MODULE_SPECIFIERS["@opentui/core"], OpenTuiCore],
  [HOST_MODULE_SPECIFIERS["@opentui/react"], OpenTuiReact],
  [HOST_MODULE_SPECIFIERS["@opentui/react/jsx-runtime"], OpenTuiJsxRuntime],
  [HOST_MODULE_SPECIFIERS["@opentui/react/jsx-dev-runtime"], OpenTuiJsxDevRuntime],
  [HOST_MODULE_SPECIFIERS["~/telemetry/index"], Telemetry],
  [HOST_MODULE_SPECIFIERS["~/api/config"], Config],
]);

let hostModulesRegistered = false;

/** Make the host's existing React and OpenTUI instances visible to payloads. */
function registerHostModules(): void {
  if (hostModulesRegistered) return;
  hostModulesRegistered = true;
  Bun.plugin({
    name: "sentry-tui-runtime-host",
    setup(build) {
      for (const [specifier, exports] of HOST_MODULES) {
        build.module(specifier, () => ({ loader: "object", exports }));
      }
    },
  });
}

function isMetadata(value: unknown): value is AppPayloadMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppPayloadMetadata>;
  return typeof candidate.version === "string" && Number.isInteger(candidate.hostApiVersion);
}

/** Read and validate a payload before executing any of its code. */
export async function readPayloadManifest(entryPath: string): Promise<AppPayloadManifest> {
  const raw = await readFile(join(dirname(entryPath), "manifest.json"), "utf8");
  const manifest: unknown = JSON.parse(raw);
  if (
    !isMetadata(manifest) ||
    typeof (manifest as Partial<AppPayloadManifest>).entry !== "string"
  ) {
    throw new Error("app payload has an invalid manifest");
  }
  const valid = manifest as AppPayloadManifest;
  if (valid.entry !== entryPath.split(/[\\/]/).at(-1)) {
    throw new Error("app payload manifest points at another entry");
  }
  if (valid.hostApiVersion !== HOST_API_VERSION) {
    throw new Error(
      `app payload needs host API ${valid.hostApiVersion}; this host provides ${HOST_API_VERSION}`,
    );
  }
  return valid;
}

/** Import a compatible payload and verify its module agrees with its manifest. */
export async function loadAppPayload(entryPath: string): Promise<LoadedAppPayload> {
  const manifest = await readPayloadManifest(entryPath);
  registerHostModules();

  const module = (await import(pathToFileURL(entryPath).href)) as AppPayloadModule;
  if (typeof module.PayloadApp !== "function" || !isMetadata(module.payload)) {
    throw new Error("app payload does not implement the runtime contract");
  }
  if (
    module.payload.version !== manifest.version ||
    module.payload.hostApiVersion !== manifest.hostApiVersion
  ) {
    throw new Error("app payload metadata does not match its manifest");
  }
  return { App: module.PayloadApp as PayloadComponent, metadata: module.payload, entryPath };
}
