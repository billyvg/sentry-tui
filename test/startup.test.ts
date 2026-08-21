import { describe, expect, test } from "bun:test";

import { HELP_TEXT, parseArgs } from "~/app/startup";

describe("parseArgs", () => {
  test("defaults to running the TUI", () => {
    expect(parseArgs([])).toEqual({
      command: "run",
      help: false,
      version: false,
      noBrowser: false,
    });
  });

  test("reads --org and its short form", () => {
    expect(parseArgs(["--org", "acme"]).org).toBe("acme");
    expect(parseArgs(["-o", "acme"]).org).toBe("acme");
  });

  test("recognizes help flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("recognizes version flags", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs([]).version).toBe(false);
  });

  test("does not consume a following flag as the org value", () => {
    expect(parseArgs(["--org", "acme", "--help"])).toEqual({
      command: "run",
      org: "acme",
      help: true,
      version: false,
      noBrowser: false,
    });
    expect(parseArgs(["--org", "--help"]).org).toBeUndefined();
  });

  test("does not swallow --version as the org value", () => {
    expect(parseArgs(["--org", "--version"])).toEqual({
      command: "run",
      help: false,
      version: true,
      noBrowser: false,
    });
    expect(parseArgs(["--org", "acme", "--version"])).toEqual({
      command: "run",
      org: "acme",
      help: false,
      version: true,
      noBrowser: false,
    });
  });

  test("reads the auth subcommands", () => {
    expect(parseArgs(["login"]).command).toBe("login");
    expect(parseArgs(["logout"]).command).toBe("logout");
    expect(parseArgs(["status"]).command).toBe("status");
  });

  test("takes --no-browser for scripted logins", () => {
    expect(parseArgs(["login", "--no-browser"])).toEqual({
      command: "login",
      help: false,
      version: false,
      noBrowser: true,
    });
  });

  test("ignores an unknown word rather than treating it as a command", () => {
    expect(parseArgs(["nonsense"]).command).toBe("run");
  });
});

describe("help text", () => {
  test("documents the auth env vars", () => {
    expect(HELP_TEXT).toContain("SENTRY_AUTH_TOKEN");
    expect(HELP_TEXT).toContain("SENTRY_ORG");
    expect(HELP_TEXT).toContain("SENTRY_TUI_LATENCY");
    expect(HELP_TEXT).toContain("SENTRY_CLIENT_ID");
  });

  test("documents the version flag", () => {
    expect(HELP_TEXT).toContain("--version");
  });

  test("documents the login commands", () => {
    expect(HELP_TEXT).toContain("sentry-tui login");
    expect(HELP_TEXT).toContain("sentry-tui logout");
    expect(HELP_TEXT).toContain("sentry-tui status");
  });
});
