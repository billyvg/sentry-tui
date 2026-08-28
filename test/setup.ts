import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flushConfigWrites } from "@sentry-tui/runtime-contract/config";

/**
 * Preloaded before any test module (see `bunfig.toml`).
 *
 * OpenTUI's reconciler root commits the initial mount outside our control, so
 * React logs an act() warning per test even though `renderHarness` flushes
 * before every assertion. Declaring an act environment silences that noise so
 * genuine warnings stay visible.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// App interactions persist preferences through a process-global host service.
// Give every Bun test process its own destination so a fixture can never reach
// the developer's config, even when a test does not install local isolation.
const testConfigDir = mkdtempSync(join(tmpdir(), "sentry-tui-test-config-"));
process.env["SENTRY_TUI_CONFIG_DIR"] = testConfigDir;

afterAll(async () => {
  await flushConfigWrites();
  rmSync(testConfigDir, { recursive: true, force: true });
});
