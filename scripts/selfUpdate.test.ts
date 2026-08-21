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

/** A cache directory holding the given versions, each with a stub binary. */
function cacheWith(versions: string[]): { env: Record<string, string>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sentry-tui-update-test-"));
  for (const version of versions) {
    mkdirSync(join(dir, version), { recursive: true });
    writeFileSync(join(dir, version, "sentry-tui"), "#!/bin/sh\nexit 0\n");
  }
  return { env: { SENTRY_TUI_CACHE_DIR: dir }, dir };
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
