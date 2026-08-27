import { expect, test } from "bun:test";

import { configureOpenTuiRuntime } from "@sentry-tui/runtime-host/opentui/openTuiRuntime";

test("OpenTUI runtime configuration preserves an explicit worker path", () => {
  const environment = { OTUI_TREE_SITTER_WORKER_PATH: "/tmp/custom-parser-worker.js" };

  configureOpenTuiRuntime(environment);

  expect(environment.OTUI_TREE_SITTER_WORKER_PATH).toBe("/tmp/custom-parser-worker.js");
});
