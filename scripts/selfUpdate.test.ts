/**
 * The self-updater, exercised without touching the network.
 *
 * This code decides which binary gets executed on every launch, so the cases
 * that matter most are the ones where it should decline to act: offline, slow,
 * corrupt, or asked to move backwards. Failing open is the whole contract —
 * an update is optional, starting the app is not.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireUpdateLock,
  bestLocal,
  cachedVersions,
  compareVersions,
  downloadIfNewer,
  fetchLatestRelease,
  updatesDisabled,
  verifyIntegrity,
} from "../packaging/npm/update.mjs";
import {
  APP_FIRST_CHECK_MS,
  shouldCheckAfterRun,
  startBackgroundUpdate,
} from "../packaging/npm/launch.mjs";
import {
  canSelfUpdate,
  type ReadyUpdate,
  readyUpdate,
  UPDATE_FIRST_CHECK_MS,
  UPDATE_POLL_MS,
  watchForUpdate,
} from "../src/app/selfUpdate.ts";
import { APP_VERSION } from "../src/lib/version.ts";

/** A cache directory holding the given versions, each with a stub binary. */
function cacheWith(versions: string[]): { env: Record<string, string>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-update-test-"));
  for (const version of versions) {
    mkdirSync(join(dir, version), { recursive: true });
    writeFileSync(join(dir, version, "sentry-tui"), "#!/bin/sh\nexit 0\n");
  }
  return { env: { SENTRY_TUI_CACHE_DIR: dir }, dir };
}

/** The version one patch above `version` — always an update, whatever we cut. */
function bumped(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version.split("-", 1)[0]!.split(".");
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

/** A fetch that answers the metadata request and nothing else. */
function stubFetch(body: unknown, { ok = true, status = 200 } = {}) {
  return async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response;
}

describe("compareVersions", () => {
  test("orders by major, minor, then patch", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  test("sorts a prerelease below the release it leads to", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.1")).toBeGreaterThan(0);
  });

  test("treats missing and malformed parts as zero rather than throwing", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("", "0.0.0")).toBe(0);
    expect(compareVersions("garbage", "0.0.1")).toBeLessThan(0);
  });
});

describe("the local cache", () => {
  test("lists versions newest first, ignoring directories with no binary", () => {
    const { env, dir } = cacheWith(["0.1.0", "0.3.0", "0.2.0"]);
    try {
      mkdirSync(join(dir, "0.9.0"), { recursive: true }); // no binary inside
      expect(cachedVersions(env)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing cache directory is empty, not an error", () => {
    expect(cachedVersions({ SENTRY_TUI_CACHE_DIR: "/nonexistent/sentry-tui-test" })).toEqual([]);
  });

  test("prefers a newer cached build over the bundled one", () => {
    const { env, dir } = cacheWith(["0.2.0"]);
    try {
      const chosen = bestLocal({ version: "0.1.0", path: "/bundled/sentry-tui" }, env);
      expect(chosen.version).toBe("0.2.0");
      expect(chosen.path).toBe(join(dir, "0.2.0", "sentry-tui"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps the bundled build when the cache is older", () => {
    const { env, dir } = cacheWith(["0.0.9"]);
    try {
      const chosen = bestLocal({ version: "0.1.0", path: "/bundled/sentry-tui" }, env);
      expect(chosen.version).toBe("0.1.0");
      expect(chosen.path).toBe("/bundled/sentry-tui");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integrity", () => {
  const bytes = Buffer.from("a tarball, allegedly");
  const digest = createHash("sha512").update(bytes).digest("base64");

  test("accepts the digest the registry advertised", () => {
    expect(() => verifyIntegrity(bytes, `sha512-${digest}`)).not.toThrow();
  });

  test("rejects a payload that does not match", () => {
    expect(() => verifyIntegrity(Buffer.from("something else"), `sha512-${digest}`)).toThrow(
      /integrity check/,
    );
  });

  test("rejects an algorithm it does not recognise", () => {
    expect(() => verifyIntegrity(bytes, `md5-${digest}`)).toThrow(/unsupported integrity/);
  });
});

describe("fetchLatestRelease", () => {
  const release = (tarball: string) => ({
    version: "9.9.9",
    dist: { tarball, integrity: "sha512-whatever" },
  });

  test("returns the version and tarball the registry reports", async () => {
    const found = await fetchLatestRelease({
      packageName: "@billyvg/sentry-tui-darwin-arm64",
      fetchImpl: stubFetch(
        release("https://registry.npmjs.org/@billyvg/sentry-tui-darwin-arm64/-/x-9.9.9.tgz"),
      ),
    });

    expect(found.version).toBe("9.9.9");
    expect(found.integrity).toBe("sha512-whatever");
  });

  test("refuses a tarball hosted anywhere but the registry", async () => {
    // The response body chooses what gets downloaded and executed, so this is
    // the one field that must not be trusted on its face.
    await expect(
      fetchLatestRelease({
        packageName: "@billyvg/sentry-tui-darwin-arm64",
        fetchImpl: stubFetch(release("https://evil.example.com/payload.tgz")),
      }),
    ).rejects.toThrow(/refusing tarball from evil.example.com/);
  });

  test("treats a non-200 as a failure", async () => {
    await expect(
      fetchLatestRelease({
        packageName: "nope",
        fetchImpl: stubFetch({}, { ok: false, status: 404 }),
      }),
    ).rejects.toThrow(/404/);
  });
});

describe("downloadIfNewer", () => {
  const release = {
    version: "9.9.9",
    dist: {
      tarball: "https://registry.npmjs.org/@billyvg/sentry-tui-darwin-arm64/-/x-9.9.9.tgz",
      integrity: "sha512-whatever",
    },
  };

  test("does nothing when the local build is already current", async () => {
    let downloads = 0;
    const result = await downloadIfNewer({
      packageName: "@billyvg/sentry-tui-darwin-arm64",
      localVersion: "9.9.9",
      env: { SENTRY_TUI_CACHE_DIR: "/nonexistent/sentry-tui-test" },
      fetchImpl: (async (url: string) => {
        if (url.endsWith(".tgz")) downloads++;
        return { ok: true, status: 200, json: async () => release } as unknown as Response;
      }) as unknown as typeof fetch,
    });

    expect(result.status).toBe("current");
    expect(downloads).toBe(0);
  });

  test("does not move backwards when the registry reports an older release", async () => {
    const result = await downloadIfNewer({
      packageName: "@billyvg/sentry-tui-darwin-arm64",
      localVersion: "10.0.0",
      env: { SENTRY_TUI_CACHE_DIR: "/nonexistent/sentry-tui-test" },
      fetchImpl: stubFetch(release),
    });

    expect(result.status).toBe("current");
  });

  test("propagates a network failure to the worker, which logs it", async () => {
    // The worker is the only caller and it swallows this; the point is that
    // nothing here retries or falls over.
    await expect(
      downloadIfNewer({
        packageName: "@billyvg/sentry-tui-darwin-arm64",
        localVersion: "0.1.0",
        env: { SENTRY_TUI_CACHE_DIR: "/nonexistent/sentry-tui-test" },
        fetchImpl: (async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/ENOTFOUND/);
  });

  test("stands down when another process holds the lock", async () => {
    const { env, dir } = cacheWith([]);
    try {
      const held = acquireUpdateLock(env);
      expect(held).toBeDefined();

      const result = await downloadIfNewer({
        packageName: "@billyvg/sentry-tui-darwin-arm64",
        localVersion: "0.1.0",
        env,
        fetchImpl: stubFetch(release),
      });

      expect(result.status).toBe("locked");
      held?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the update lock", () => {
  test("only one holder at a time", () => {
    const { env, dir } = cacheWith([]);
    try {
      const first = acquireUpdateLock(env);
      expect(first).toBeDefined();
      expect(acquireUpdateLock(env)).toBeUndefined();

      first?.();
      expect(acquireUpdateLock(env)).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a lock left by a killed process is reclaimed once it is stale", () => {
    const { env, dir } = cacheWith([]);
    try {
      acquireUpdateLock(env);
      // Nothing would ever update again if an abandoned lock were permanent.
      expect(acquireUpdateLock(env, -1)).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("updatesDisabled", () => {
  test("honours the opt-out and common CI markers", () => {
    expect(updatesDisabled({ SENTRY_TUI_NO_UPDATE: "1" })).toBe(true);
    expect(updatesDisabled({ CI: "true" })).toBe(true);
    expect(updatesDisabled({})).toBe(false);
  });
});

describe("what the running app is offered", () => {
  test("a cached build newer than the running one is offered, with its path", () => {
    const { env, dir } = cacheWith([bumped(APP_VERSION)]);
    try {
      const ready = readyUpdate(env);
      expect(ready?.version).toBe(bumped(APP_VERSION));
      expect(ready?.path).toBe(join(dir, bumped(APP_VERSION), "sentry-tui"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the running version, and anything below it, is not an update", () => {
    // The launcher leaves the build it started us on in the cache, so the
    // common case is a cache whose newest entry is exactly what is running.
    const { env, dir } = cacheWith(["0.0.1", APP_VERSION]);
    try {
      expect(readyUpdate(env)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty cache offers nothing rather than throwing", () => {
    expect(
      readyUpdate({ SENTRY_TUI_CACHE_DIR: join(tmpdir(), "sentry-tui-not-a-directory") }),
    ).toBeUndefined();
  });
});

describe("canSelfUpdate", () => {
  const managed = { SENTRY_TUI_MANAGED: "1" };

  test("only inside a process the npm launcher started", () => {
    // Without the marker the binary was run some other way — off the releases
    // page, say — where a restart into the cache reverts on the next launch.
    expect(canSelfUpdate({})).toBe(false);
    expect(canSelfUpdate(managed)).toBe(true);
  });

  test("the same opt-outs the launcher honours close it too", () => {
    expect(canSelfUpdate({ ...managed, SENTRY_TUI_NO_UPDATE: "1" })).toBe(false);
    expect(canSelfUpdate({ ...managed, CI: "true" })).toBe(false);
  });
});

describe("when the app looks", () => {
  const managed = (env: Record<string, string>) => ({ ...env, SENTRY_TUI_MANAGED: "1" });

  /** Wait out a compressed schedule without pinning an exact tick count. */
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("the cache is read straight away, before any check is due", () => {
    const { env, dir } = cacheWith([bumped(APP_VERSION)]);
    try {
      const seen: (ReadyUpdate | undefined)[] = [];
      // Nothing may reach the network to produce this first answer: the build
      // is already on disk, so the pill has to appear without asking anyone.
      const stop = watchForUpdate((update) => seen.push(update), {
        env: managed(env),
        firstCheckMs: 60_000,
        check: async () => {
          throw new Error("checked the registry when the answer was on disk");
        },
      });

      expect(seen.length).toBe(1);
      expect(seen[0]?.version).toBe(bumped(APP_VERSION));
      stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a real check follows shortly after, then repeats on the poll", async () => {
    const { env, dir } = cacheWith([]);
    try {
      let checks = 0;
      const stop = watchForUpdate(() => {}, {
        env: managed(env),
        firstCheckMs: 5,
        pollMs: 10,
        check: async () => {
          checks++;
          return undefined;
        },
      });

      await settle(60);
      stop();
      // One at the first tick and several on the poll; the exact number is
      // timer scheduling, the point is that neither waited an hour.
      expect(checks).toBeGreaterThan(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the schedule it actually ships with checks long before the poll", () => {
    // The tests above compress the numbers, so this is what ties them to the
    // real thing: a session has to be offered a new release without sitting
    // through an hour of it.
    expect(UPDATE_FIRST_CHECK_MS).toBeGreaterThan(0);
    expect(UPDATE_FIRST_CHECK_MS).toBeLessThan(UPDATE_POLL_MS / 10);
  });

  test("stopping the watch stops the checks", async () => {
    const { env, dir } = cacheWith([]);
    try {
      let checks = 0;
      const stop = watchForUpdate(() => {}, {
        env: managed(env),
        firstCheckMs: 1,
        pollMs: 2,
        check: async () => {
          checks++;
          return undefined;
        },
      });

      await settle(20);
      stop();
      const atStop = checks;
      await settle(20);
      expect(checks).toBe(atStop);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a later answer of nothing withdraws the offer", async () => {
    // `pruneCache` can delete the build under us, and an offer to restart into
    // a path that no longer exists is worse than no offer.
    const { env, dir } = cacheWith([bumped(APP_VERSION)]);
    try {
      const seen: (ReadyUpdate | undefined)[] = [];
      const stop = watchForUpdate((update) => seen.push(update), {
        env: managed(env),
        firstCheckMs: 1,
        pollMs: 10_000,
        check: async () => undefined,
      });

      await settle(20);
      stop();
      expect(seen[0]?.version).toBe(bumped(APP_VERSION));
      expect(seen.at(-1)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nothing happens at all when the launcher did not start us", async () => {
    const { env, dir } = cacheWith([bumped(APP_VERSION)]);
    try {
      let checks = 0;
      const seen: (ReadyUpdate | undefined)[] = [];
      const stop = watchForUpdate((update) => seen.push(update), {
        env, // no SENTRY_TUI_MANAGED
        firstCheckMs: 1,
        pollMs: 2,
        check: async () => {
          checks++;
          return undefined;
        },
      });

      await settle(20);
      stop();
      expect(seen).toEqual([]);
      expect(checks).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("when the launcher looks", () => {
  test("only for a child that went before the app could have checked", () => {
    // Every command that never starts the app is over in well under a second,
    // so this covers `--help`, `--version`, `login`, `logout` and `status`
    // without the launcher being told what any of them are.
    expect(shouldCheckAfterRun(0)).toBe(true);
    expect(shouldCheckAfterRun(300)).toBe(true);
    expect(shouldCheckAfterRun(APP_FIRST_CHECK_MS - 1)).toBe(true);

    // And a session that was up long enough owned the check itself. Drop this
    // and every interactive session checks twice, which is the half of #103
    // that moving the call alone did not fix.
    expect(shouldCheckAfterRun(APP_FIRST_CHECK_MS)).toBe(false);
    expect(shouldCheckAfterRun(60 * 60 * 1000)).toBe(false);
  });

  test("it stands down rather than spawning a worker that would do nothing", () => {
    // The launcher's own check is the other half of the cadence, and these are
    // the cases where starting a process at all is wasted work.
    expect(startBackgroundUpdate({ packageName: undefined, env: {} })).toBe(false);
    expect(
      startBackgroundUpdate({ packageName: "@billyvg/sentry-tui-darwin-arm64", env: { CI: "1" } }),
    ).toBe(false);
    expect(
      startBackgroundUpdate({
        packageName: "@billyvg/sentry-tui-darwin-arm64",
        env: { SENTRY_TUI_NO_UPDATE: "1" },
      }),
    ).toBe(false);
  });
});
