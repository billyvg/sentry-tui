import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError } from "~/api/client";
import {
  bootstrap,
  classifyStartupFailure,
  HELP_TEXT,
  InvalidOrgSelectionError,
  MissingOrgError,
  MissingTokenError,
  parseArgs,
  parseOrgSelection,
  SentryUrlInputError,
} from "~/app/startup";
import { HOST_VERSION, VERSION_LABEL } from "~/lib/version";

/** Bootstrap against one throwaway user config and restore the process env. */
async function bootstrapWithConfig(config: unknown, argv: string[] = [], fetchImpl?: typeof fetch) {
  const configDir = mkdtempSync(join(tmpdir(), "sentry-tui-startup-"));
  const previousConfigDir = process.env["SENTRY_TUI_CONFIG_DIR"];
  const previousToken = process.env["SENTRY_AUTH_TOKEN"];
  process.env["SENTRY_TUI_CONFIG_DIR"] = configDir;
  process.env["SENTRY_AUTH_TOKEN"] = "sntryu_test";

  try {
    await Bun.write(join(configDir, "config.json"), JSON.stringify(config));
    return await bootstrap(parseArgs(argv), fetchImpl ? { fetchImpl } : {});
  } finally {
    if (previousConfigDir === undefined) delete process.env["SENTRY_TUI_CONFIG_DIR"];
    else process.env["SENTRY_TUI_CONFIG_DIR"] = previousConfigDir;
    if (previousToken === undefined) delete process.env["SENTRY_AUTH_TOKEN"];
    else process.env["SENTRY_AUTH_TOKEN"] = previousToken;
    rmSync(configDir, { recursive: true, force: true });
  }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

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

  test("takes a production URL as the TUI destination", () => {
    expect(parseArgs(["https://acme.sentry.io/explore/logs/", "--org", "acme"])).toEqual({
      command: "run",
      org: "acme",
      help: false,
      version: false,
      noBrowser: false,
      url: "https://acme.sentry.io/explore/logs/",
    });
  });

  test("ignores an unknown word rather than treating it as a command", () => {
    expect(parseArgs(["nonsense"]).command).toBe("run");
  });
});

test("startup carries org-bound project selections into the app context", async () => {
  const context = await bootstrapWithConfig({
    org: "acme",
    projectsByOrg: { acme: ["backend"], globex: ["frontend"] },
  });

  expect(context.projectsByOrg).toEqual({ acme: ["backend"], globex: ["frontend"] });
});

test("startup ignores malformed project selections in the user config", async () => {
  const context = await bootstrapWithConfig({
    org: "acme",
    projectsByOrg: {
      acme: ["backend", 42],
      globex: "frontend",
      empty: [],
    },
  });

  expect(context.projectsByOrg).toEqual({ acme: ["backend"], empty: [] });
});

test("startup keeps only valid Seer preferences from editable config", async () => {
  const context = await bootstrapWithConfig({
    org: "acme",
    seerCodeModeByOrg: { acme: "on", globex: "sometimes" },
    seerBashModeByOrg: { acme: true, globex: "yes" },
    seerShowThinkingByOrg: { acme: false, globex: 1 },
  });

  expect(context.seerCodeModeByOrg).toEqual({ acme: "on" });
  expect(context.seerBashModeByOrg).toEqual({ acme: true });
  expect(context.seerShowThinkingByOrg).toEqual({ acme: false });
});

test("a CLI URL supplies the startup organization and initial location", async () => {
  const context = await bootstrapWithConfig({ org: "globex" }, [
    "https://sentry.io/organizations/acme/explore/logs/?query=level%3Aerror",
  ]);

  expect(context.org).toBe("acme");
  expect(context.initialLocation).toEqual({
    org: "acme",
    screen: "explore.logs",
    state: { query: "level:error" },
  });
});

test("a conflicting explicit organization is rejected as URL input", async () => {
  expect(
    bootstrapWithConfig({ org: "acme" }, ["https://acme.sentry.io/issues/", "--org", "globex"]),
  ).rejects.toThrow("Invalid Sentry URL: --org globex conflicts");
});

test("a valid unsupported Sentry URL is reported as not implemented", async () => {
  expect(
    bootstrapWithConfig({ org: "acme" }, ["https://acme.sentry.io/settings/projects/"]),
  ).rejects.toThrow("Not implemented: That Sentry page is not implemented");
});

describe("startup failures", () => {
  test("raises a typed expected error when the token has no organizations", async () => {
    const fetchImpl = (async () => json([])) as unknown as typeof fetch;
    const error = await bootstrapWithConfig({}, [], fetchImpl).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MissingOrgError);
    expect(classifyStartupFailure(error)).toBe("missing_organizations");
  });

  test("keeps the API error from a failed organization request", async () => {
    const fetchImpl = (async () =>
      json({ detail: "missing scope" }, { status: 403 })) as unknown as typeof fetch;
    const error = await bootstrapWithConfig({}, [], fetchImpl).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect(classifyStartupFailure(error)).toBe("handled_at_source");
  });

  test("raises a typed expected error for an invalid organization selection", () => {
    expect(() => parseOrgSelection("not a number", 2)).toThrow(InvalidOrgSelectionError);
    expect(classifyStartupFailure(new InvalidOrgSelectionError())).toBe("invalid_org_selection");
  });

  test("classifies only unknown failures for a startup error report", () => {
    expect(classifyStartupFailure(new MissingTokenError())).toBe("missing_credentials");
    expect(
      classifyStartupFailure(
        new SentryUrlInputError({
          kind: "invalid",
          reason: "malformed",
          message: "Not a Sentry URL.",
        }),
      ),
    ).toBe("handled_at_source");
    expect(classifyStartupFailure(new Error("boom"))).toBe("unexpected");
  });
});

describe("help text", () => {
  test("documents the auth env vars", () => {
    expect(HELP_TEXT).toContain("SENTRY_AUTH_TOKEN");
    expect(HELP_TEXT).toContain("SENTRY_ORG");
    expect(HELP_TEXT).toContain("SENTRY_TUI_LATENCY");
    expect(HELP_TEXT).toContain("SENTRY_CLIENT_ID");
    expect(HELP_TEXT).toContain("SENTRY_TUI_THEME");
  });

  test("documents the version flag", () => {
    expect(HELP_TEXT).toContain("--version");
  });

  test("documents the login commands", () => {
    expect(HELP_TEXT).toContain("sentry-tui login");
    expect(HELP_TEXT).toContain("sentry-tui logout");
    expect(HELP_TEXT).toContain("sentry-tui status");
  });

  test("documents opening a production URL", () => {
    expect(HELP_TEXT).toContain("sentry-tui <url>");
  });

  test("describes the preferences stored in config.json", () => {
    expect(HELP_TEXT).toContain("organization and project selections");
  });
});

describe("--version output", () => {
  // Built from HOST_VERSION rather than VERSION_LABEL, so the `v` prefix is
  // pinned too.
  test("the label carries a v prefix", () => {
    expect(VERSION_LABEL).toBe(`v${HOST_VERSION}`);
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

    expect(result.stdout.toString()).toBe(`sentry-tui v${HOST_VERSION}\n`);
    expect(result.exitCode).toBe(0);
  });
});
