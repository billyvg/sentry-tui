import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the test runner replaces the user's config directory with a temporary one", () => {
  const configDir = process.env["SENTRY_TUI_CONFIG_DIR"];

  expect(configDir?.startsWith(join(tmpdir(), "sentry-tui-test-config-"))).toBe(true);
});
