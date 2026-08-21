import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { HELP_TEXT, parseArgs } from "~/app/startup";
import { APP_VERSION, VERSION_LABEL } from "~/lib/version";

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

describe("--version output", () => {
  // Built from APP_VERSION rather than VERSION_LABEL, so the `v` prefix is
  // pinned too. The label is shared with the palette footer, whose hint is fit
  // to the width the version leaves over — shaving that `v` for a cell would
  // otherwise quietly rewrite what the CLI prints.
  test("the label carries a v prefix", () => {
    expect(VERSION_LABEL).toBe(`v${APP_VERSION}`);
  });

  // The one spawn in the suite. `main.tsx` is a top-level script with a
  // `process.exit` in it, so its branch cannot be imported and called — and
  // nothing else proves the flag reaches stdout at all.
  test("prints the version and exits 0", () => {
    const result = Bun.spawnSync(["bun", "run", "src/main.tsx", "--version"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stdout.toString()).toBe(`sentry-tui v${APP_VERSION}\n`);
    expect(result.exitCode).toBe(0);
  });
});
