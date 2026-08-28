import { describe, expect, test } from "bun:test";

import type { ReportContext } from "@sentry-tui/runtime-contract/telemetry";
import {
  loadUpdatePayload,
  type PayloadLoadContext,
} from "@sentry-tui/runtime-host/update/loadPayload";
import type { LoadedAppPayload } from "@sentry-tui/runtime-host/ui/loadPayload";

const CONTEXT: PayloadLoadContext = { stage: "apply", version: "0.12.0" };

describe("loadUpdatePayload", () => {
  test("returns a valid payload without reporting or discarding it", async () => {
    const loaded = {
      App: () => null,
      metadata: { version: "0.12.0", hostApiVersion: 1 },
      entryPath: "/cache/0.12.0/app/app.mjs",
    } satisfies LoadedAppPayload;
    let reports = 0;
    let discards = 0;

    const result = await loadUpdatePayload(loaded.entryPath, CONTEXT, {
      load: async () => loaded,
      report: () => reports++,
      discard: () => (discards++, true),
    });

    expect(result).toBe(loaded);
    expect({ reports, discards }).toEqual({ reports: 0, discards: 0 });
  });

  test("reports a failed payload before discarding it", async () => {
    const failure = new Error("payload import failed");
    const calls: string[] = [];
    let reported: { error: unknown; context?: ReportContext } | undefined;

    const result = await loadUpdatePayload("/Users/someone/.cache/app.mjs", CONTEXT, {
      load: async () => {
        throw failure;
      },
      report: (error, context) => {
        calls.push("report");
        reported = { error, context };
      },
      discard: () => {
        calls.push("discard");
        return true;
      },
    });

    expect(result).toBeUndefined();
    expect(calls).toEqual(["report", "discard"]);
    expect(reported).toEqual({
      error: failure,
      context: {
        source: "app.update.failed",
        handled: true,
        tags: { update_kind: "payload", update_stage: "apply" },
        extra: { update_version: "0.12.0" },
      },
    });
    expect(JSON.stringify(reported)).not.toContain("/Users/someone");
  });

  test("reports startup failures without inventing an unknown version", async () => {
    let context: ReportContext | undefined;

    await loadUpdatePayload(
      "/cache/app.mjs",
      { stage: "startup" },
      {
        load: async () => {
          throw new Error("invalid manifest");
        },
        report: (_error, reportContext) => {
          context = reportContext;
        },
        discard: () => true,
      },
    );

    expect(context).toEqual({
      source: "app.update.failed",
      handled: true,
      tags: { update_kind: "payload", update_stage: "startup" },
      extra: undefined,
    });
  });
});
