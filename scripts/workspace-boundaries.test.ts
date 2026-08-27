import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface Manifest {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  sentryTui?: { releaseComponents?: string[] };
}

const ROOT = join(import.meta.dirname, "..");

/** Read one repository manifest without evaluating package code. */
async function manifest(path: string): Promise<Manifest> {
  return (await Bun.file(join(ROOT, path, "package.json")).json()) as Manifest;
}

describe("workspace architecture", () => {
  test("the root owns four explicit package workspaces", async () => {
    const root = await manifest("");
    expect(root.workspaces).toEqual(["packages/*"]);
    expect(
      await Promise.all(
        ["app", "launcher", "runtime-contract", "runtime-host"].map(
          async (name) => (await manifest(`packages/${name}`)).name,
        ),
      ),
    ).toEqual([
      "@sentry-tui/app",
      "@sentry-tui/launcher",
      "@sentry-tui/runtime-contract",
      "@sentry-tui/runtime-host",
    ]);
  });

  test("app depends on the contract and never on host implementations", async () => {
    const app = await manifest("packages/app");
    expect(app.dependencies?.["@sentry-tui/runtime-contract"]).toBe("workspace:*");
    expect(app.dependencies?.["@sentry-tui/runtime-host"]).toBeUndefined();
    expect(app.dependencies?.["@sentry-tui/launcher"]).toBeUndefined();
  });

  test("release ownership comes from package manifests", async () => {
    const app = await manifest("packages/app");
    const host = await manifest("packages/runtime-host");
    const launcher = await manifest("packages/launcher");
    const contract = await manifest("packages/runtime-contract");

    expect(app.sentryTui?.releaseComponents).toEqual(["app"]);
    expect(host.sentryTui?.releaseComponents).toEqual(["host"]);
    expect(launcher.sentryTui?.releaseComponents).toEqual(["host"]);
    expect(contract.sentryTui?.releaseComponents).toBeUndefined();
  });
});
