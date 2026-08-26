// Plain JS, no dependencies: this ships to npm and runs under Node.
//
// Keeping the binary current without the user thinking about it, and without
// making them wait. The app starts immediately on whatever is already here;
// a detached worker fetches anything newer into a cache alongside it, and the
// next launch picks that up. Releases land often enough that "run `npm i -g`
// again" is not a reasonable thing to ask of anyone.
//
// Everything here fails open. An update is a nice-to-have; starting the app is
// not. Offline, slow, rate-limited, corrupt download, unwritable cache — each
// one leaves the binary already on disk in place.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * @typedef {(url: string, init?: object) => Promise<any>} FetchLike
 * @typedef {{version?: string, path: string}} Binary
 * @typedef {{version: string, tarball: string, integrity?: string}} Release
 */

/** Only ever fetched from here — metadata and tarball alike. */
export const REGISTRY_HOST = "registry.npmjs.org";

/** How long to wait on the "what is the latest version" request. */
export const CHECK_TIMEOUT_MS = 2000;

/** Cached builds to keep, newest first. One spare allows a manual rollback. */
const KEEP_VERSIONS = 2;

/** How long before a lock left by a killed process is treated as abandoned. */
const LOCK_STALE_MS = 10 * 60 * 1000;

/** Set any of these to skip the update check entirely. */
export function updatesDisabled(env = process.env) {
  return Boolean(env.SENTRY_TUI_NO_UPDATE || env.NO_UPDATE_NOTIFIER || env.CI);
}

/**
 * Compare two `major.minor.patch[-prerelease]` versions.
 *
 * Returns a negative number when `a` is older. Prereleases sort below the
 * release they lead to, and are compared as strings after that — enough for
 * `0.2.0-beta.1` vs `0.2.0` without carrying a semver library into the tarball.
 */
export function compareVersions(a, b) {
  const parse = (version) => {
    const [core = "", prerelease = ""] = String(version).split("-", 2);
    const numbers = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { numbers, prerelease };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** Where downloaded builds live, one directory per version. */
export function cacheRoot(env = process.env) {
  if (env.SENTRY_TUI_CACHE_DIR) return env.SENTRY_TUI_CACHE_DIR;
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "sentry-tui", "versions");
}

/** Path a given version's binary would occupy, whether or not it is there. */
export function cachedBinary(version, env = process.env) {
  return join(cacheRoot(env), version, "sentry-tui");
}

/** Versions present in the cache, newest first. */
export function cachedVersions(env = process.env) {
  try {
    return readdirSync(cacheRoot(env))
      .filter((name) => existsSync(cachedBinary(name, env)))
      .sort((a, b) => compareVersions(b, a));
  } catch {
    return [];
  }
}

/**
 * The newest binary on this machine: whatever npm installed, or a newer build
 * fetched on an earlier run.
 *
 * @param {Binary} bundled
 * @param {Record<string, string | undefined>} [env]
 * @returns {Binary}
 */
export function bestLocal(bundled, env = process.env) {
  let best = bundled;
  for (const version of cachedVersions(env)) {
    if (!best.version || compareVersions(version, best.version) > 0) {
      best = { version, path: cachedBinary(version, env) };
      break; // cachedVersions is sorted, so the first win is the best.
    }
  }
  return best;
}

/** Remove one cached version and everything stored beneath it. */
export function removeCachedVersion(version, env = process.env) {
  rmSync(join(cacheRoot(env), version), { recursive: true, force: true });
}

/**
 * Ask the registry for the newest release of `packageName`.
 *
 * Uses the single-version endpoint rather than the full packument: it is a few
 * hundred bytes and CDN-cached, which is what makes checking on every launch
 * affordable.
 */
/**
 * @param {object} options
 * @param {string} options.packageName
 * @param {number} [options.timeoutMs]
 * @param {FetchLike} [options.fetchImpl]
 * @returns {Promise<Release>}
 */
export async function fetchLatestRelease({
  packageName,
  timeoutMs = CHECK_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const url = `https://${REGISTRY_HOST}/${packageName.replace("/", "%2f")}/latest`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error(`registry returned ${response.status} for ${packageName}`);

  const body = await response.json();
  const tarball = body?.dist?.tarball;
  if (!body?.version || !tarball) throw new Error(`registry gave no tarball for ${packageName}`);

  // The tarball URL comes from the response body, so it decides what gets
  // executed. Refuse anything that points off the registry.
  const host = new URL(tarball).host;
  if (host !== REGISTRY_HOST) throw new Error(`refusing tarball from ${host}`);

  return { version: body.version, tarball, integrity: body.dist.integrity };
}

/** Check a downloaded tarball against the `sha512-…` the registry advertised. */
export function verifyIntegrity(bytes, integrity) {
  if (!integrity) return; // Older packages may predate the field; nothing to check.
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (!algorithm?.startsWith("sha")) throw new Error(`unsupported integrity ${integrity}`);

  const actual = createHash(algorithm).update(bytes).digest("base64");
  if (actual !== expected) throw new Error("downloaded binary failed its integrity check");
}

/**
 * Download a release into the cache and return the path to its binary.
 *
 * Unpacked into a temp directory inside the cache and moved into place with a
 * rename, so a half-written binary is never visible under its version — and so
 * two copies of the app racing each other cannot collide.
 */
/**
 * @param {object} options
 * @param {Release} options.release
 * @param {Record<string, string | undefined>} [options.env]
 * @param {FetchLike} [options.fetchImpl]
 * @returns {Promise<string>}
 */
export async function installRelease({ release, env = process.env, fetchImpl = fetch }) {
  const root = cacheRoot(env);
  mkdirSync(root, { recursive: true });

  const staging = mkdtempSync(join(root, ".download-"));
  try {
    const response = await fetchImpl(release.tarball);
    if (!response.ok) throw new Error(`download returned ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    verifyIntegrity(bytes, release.integrity);

    const archive = join(staging, "package.tgz");
    writeFileSync(archive, bytes);

    // `tar` rather than a JS implementation: this runs on macOS and Linux only,
    // where it is always present, and the alternative is a dependency.
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", staging, "package/bin/sentry-tui"], {
      stdio: "ignore",
    });
    if (extracted.status !== 0) throw new Error("could not unpack the downloaded release");

    const binary = join(staging, "package", "bin", "sentry-tui");
    if (!existsSync(binary)) throw new Error("the release contained no sentry-tui binary");
    chmodSync(binary, 0o755);

    const destination = join(root, release.version);
    removeCachedVersion(release.version, env);
    mkdirSync(destination, { recursive: true });
    renameSync(binary, join(destination, "sentry-tui"));

    return join(destination, "sentry-tui");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Drop old cached builds, keeping the newest few. */
export function pruneCache(env = process.env, keep = KEEP_VERSIONS) {
  for (const version of cachedVersions(env).slice(keep)) {
    removeCachedVersion(version, env);
  }
}

/**
 * Take the update lock, or return undefined when another process holds it.
 *
 * `mkdir` is the mutex: it either creates the directory or fails, atomically,
 * on every filesystem worth caring about. Several terminals launching the app
 * at once should cost one download, not one each.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {number} [staleMs] age after which a lock is assumed abandoned
 * @returns {(() => void) | undefined} release function, or undefined
 */
export function acquireUpdateLock(env = process.env, staleMs = LOCK_STALE_MS) {
  const lock = join(cacheRoot(env), ".update-lock");
  const release = () => rmSync(lock, { recursive: true, force: true });

  mkdirSync(cacheRoot(env), { recursive: true });
  try {
    mkdirSync(lock);
    return release;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  // A process killed mid-download would otherwise wedge updates forever.
  try {
    if (Date.now() - statSync(lock).mtimeMs > staleMs) {
      release();
      mkdirSync(lock);
      return release;
    }
  } catch (error) {
    // Losing a race to another process is expected; anything without an errno
    // is a bug in this file, and swallowing it would turn "updates are broken"
    // into "updates silently never happen" — which is how the missing
    // `statSync` import that this comment replaces went unnoticed.
    if (!error?.code) throw error;
  }

  return undefined;
}

/**
 * Fetch the newest release when it beats `localVersion`, into the cache.
 *
 * This is what the background worker runs. Nothing here is on the path of a
 * launch, so it is free to take as long as a 24MB download takes.
 *
 * @param {object} options
 * @param {string} options.packageName
 * @param {string} [options.localVersion] newest version already on disk
 * @param {Record<string, string | undefined>} [options.env]
 * @param {FetchLike} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{status: "updated" | "current" | "locked", version?: string}>}
 */
export async function downloadIfNewer({
  packageName,
  localVersion,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
}) {
  const release = await fetchLatestRelease({ packageName, timeoutMs, fetchImpl });
  if (localVersion && compareVersions(release.version, localVersion) <= 0) {
    return { status: "current", version: localVersion };
  }

  const unlock = acquireUpdateLock(env);
  if (!unlock) return { status: "locked" };

  try {
    await installRelease({ release, env, fetchImpl });
    try {
      pruneCache(env);
    } catch {
      // A cache we cannot tidy is not worth failing an update over.
    }
    return { status: "updated", version: release.version };
  } finally {
    unlock();
  }
}
