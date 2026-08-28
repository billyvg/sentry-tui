import { countMetric, reportError } from "@sentry-tui/runtime-host/telemetry/index";

type UpdateKind = "payload" | "host";
type UpdateFailureStage = "apply" | "discard" | "startup";

/**
 * Preserve an update failure without ever attaching its local cache path.
 *
 * Version is intentionally a tag: releases are a bounded set and being able
 * to isolate one broken payload is the reason this report exists.
 */
export function reportUpdateFailure(
  error: unknown,
  { kind, version, stage }: { kind: UpdateKind; version: string; stage: UpdateFailureStage },
): void {
  reportError(error, {
    source: "app.update.failed",
    handled: true,
    tags: {
      "update.kind": kind,
      "update.version": version,
      "update.stage": stage,
    },
  });
}

/** Count an expected update-check failure without filing it as a bug. */
export function countUpdateCheckFailure(kind: UpdateKind): void {
  countMetric("app.update.check_failed", { kind });
}
