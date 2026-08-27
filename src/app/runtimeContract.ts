/**
 * Runtime API implemented by the compiled host and consumed by app payloads.
 *
 * Bump this only when a payload can no longer run against an older host. The
 * updater reads the payload manifest before importing any of its code, so an
 * incompatible payload can fall back to the full-binary restart path.
 */
export const HOST_API_VERSION = 1;

const HOST_DEPENDENCIES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@opentui/core",
  "@opentui/react",
  "@opentui/react/jsx-runtime",
  "@opentui/react/jsx-dev-runtime",
  "~/telemetry/index",
  "~/api/config",
  "~/lib/version",
] as const;

/**
 * Build-time dependency name to runtime virtual module.
 *
 * Each replacement has exactly the same length as its source. `build-app.ts`
 * rewrites these strings after sourcemap generation; equal lengths preserve
 * every generated column in that map.
 */
export const HOST_MODULE_SPECIFIERS: Readonly<Record<(typeof HOST_DEPENDENCIES)[number], string>> =
  Object.fromEntries(
    HOST_DEPENDENCIES.map((dependency, index) => [
      dependency,
      `h:${index}`.padEnd(dependency.length, "_"),
    ]),
  ) as Record<(typeof HOST_DEPENDENCIES)[number], string>;

/** Metadata duplicated in the payload module and its sidecar manifest. */
export interface AppPayloadMetadata {
  version: string;
  hostApiVersion: number;
}

/** Sidecar written beside every built payload. */
export interface AppPayloadManifest extends AppPayloadMetadata {
  entry: string;
}
