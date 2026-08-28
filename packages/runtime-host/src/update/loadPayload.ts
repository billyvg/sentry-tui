import type { ReportContext } from "@sentry-tui/runtime-contract/telemetry";
import { reportError } from "@sentry-tui/runtime-host/telemetry/index";
import { discardFailedPayload } from "@sentry-tui/runtime-host/update/selfUpdate";
import { loadAppPayload, type LoadedAppPayload } from "@sentry-tui/runtime-host/ui/loadPayload";

export interface PayloadLoadContext {
  /** Where the host was in its lifecycle when it tried the payload. */
  stage: "startup" | "apply";
  /** Known for an in-session offer; startup paths do not always carry it. */
  version?: string;
}

interface PayloadLoadDependencies {
  load: (entryPath: string) => Promise<LoadedAppPayload>;
  report: (error: unknown, context?: ReportContext) => void;
  discard: (entryPath: string) => boolean;
}

const DEFAULT_DEPENDENCIES: PayloadLoadDependencies = {
  load: loadAppPayload,
  report: reportError,
  discard: discardFailedPayload,
};

/**
 * Load one replaceable payload, reporting and removing it when validation or import fails.
 *
 * The local path is deliberately absent from telemetry: it can contain a user name and is
 * not useful for grouping. Stage and version distinguish the bounded cases instead.
 */
export async function loadUpdatePayload(
  entryPath: string,
  context: PayloadLoadContext,
  dependencies: PayloadLoadDependencies = DEFAULT_DEPENDENCIES,
): Promise<LoadedAppPayload | undefined> {
  try {
    return await dependencies.load(entryPath);
  } catch (error) {
    dependencies.report(error, {
      source: "app.update.failed",
      handled: true,
      tags: {
        update_kind: "payload",
        update_stage: context.stage,
      },
      extra: context.version ? { update_version: context.version } : undefined,
    });
    dependencies.discard(entryPath);
    return undefined;
  }
}
