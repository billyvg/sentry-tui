import { describe, expect, test } from "bun:test";

import { HELP_TEXT, parseArgs } from "~/app/startup";

describe("parseArgs", () => {
  test("defaults to no org and no help", () => {
    expect(parseArgs([])).toEqual({ help: false });
  });

  test("reads --org and its short form", () => {
    expect(parseArgs(["--org", "acme"]).org).toBe("acme");
    expect(parseArgs(["-o", "acme"]).org).toBe("acme");
  });

  test("recognizes help flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("does not consume a following flag as the org value", () => {
    expect(parseArgs(["--org", "acme", "--help"])).toEqual({
      org: "acme",
      help: true,
    });
  });
});

test("help text documents the auth env vars", () => {
  expect(HELP_TEXT).toContain("SENTRY_AUTH_TOKEN");
  expect(HELP_TEXT).toContain("SENTRY_ORG");
  expect(HELP_TEXT).toContain("SENTRY_TUI_LATENCY");
});
