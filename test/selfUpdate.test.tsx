/**
 * The update offer, from a cached binary on disk to a restart.
 *
 * Driven through the real code path rather than a stubbed hook: the env seams
 * `packaging/npm/update.mjs` already honours (`SENTRY_TUI_CACHE_DIR`) plus the
 * marker the launcher sets (`SENTRY_TUI_MANAGED`) are enough to stand the whole
 * thing up. Nothing here touches the network — the mount-time look is a
 * directory read, and the hourly poll never fires inside a test.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { theme } from "~/core/theme";
import { App } from "~/ui/App";
import { BOLD } from "~/ui/lib/attributes";
import { renderHarness } from "./helpers";

/** Far enough above any version this repo will cut to always be an update. */
const NEWER = "999.0.0";

/** Status bar row and the first cell of the pill, at the harness's default size. */
const STATUS_ROW = 23;
const PILL_X = 1;

/**
 * Env this suite owns. `CI` and the opt-outs are cleared rather than merely
 * unset by chance — GitHub Actions sets `CI`, which would otherwise close the
 * gate and pass every one of these tests for the wrong reason.
 */
const OWNED = [
  "SENTRY_TUI_MANAGED",
  "SENTRY_TUI_CACHE_DIR",
  "SENTRY_TUI_NO_UPDATE",
  "NO_UPDATE_NOTIFIER",
  "CI",
] as const;

let cacheDir: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of OWNED) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  cacheDir = mkdtempSync(join(tmpdir(), "sentry-tui-update-pill-"));
  process.env.SENTRY_TUI_MANAGED = "1";
  process.env.SENTRY_TUI_CACHE_DIR = cacheDir;
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

/** Put a downloaded build in the cache, the way the update worker would. */
function cacheBuild(version: string): string {
  mkdirSync(join(cacheDir, version), { recursive: true });
  const path = join(cacheDir, version, "sentry-tui");
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  return path;
}

const renderApp = (onRestart?: (path: string) => void) =>
  renderHarness(<App onQuit={() => {}} onRestart={onRestart} />);

test("nothing downloaded means nothing in the corner", async () => {
  const h = await renderApp(() => {});
  try {
    expect(h.frame()).not.toContain("Update");
  } finally {
    await h.cleanup();
  }
});

test("a downloaded build puts Update in the corner, bold and pink", async () => {
  cacheBuild(NEWER);
  const h = await renderApp(() => {});
  try {
    const span = h.spanContaining("Update");
    expect(span).toBeDefined();
    // Bold and pink is the whole point: it has to survive being ignored for an
    // hour without reading as another "loading issues…".
    expect(span!.attributes & BOLD).toBe(BOLD);
    expect(Math.round(span!.fg.r * 255)).toBe(parseInt(theme.highlight.slice(1, 3), 16));
    expect(Math.round(span!.fg.g * 255)).toBe(parseInt(theme.highlight.slice(3, 5), 16));
    expect(Math.round(span!.fg.b * 255)).toBe(parseInt(theme.highlight.slice(5, 7), 16));
  } finally {
    await h.cleanup();
  }
});

test("clicking it hands over the path to the cached binary", async () => {
  const path = cacheBuild(NEWER);
  const restarts: string[] = [];
  const h = await renderApp((p) => restarts.push(p));
  try {
    await h.click(PILL_X, STATUS_ROW);
    expect(restarts).toEqual([path]);
  } finally {
    await h.cleanup();
  }
});

test("U does the same as clicking it", async () => {
  const path = cacheBuild(NEWER);
  const restarts: string[] = [];
  const h = await renderApp((p) => restarts.push(p));
  try {
    await h.press((i) => i.pressKey("U"));
    expect(restarts).toEqual([path]);
  } finally {
    await h.cleanup();
  }
});

test("U with nothing waiting answers rather than doing nothing", async () => {
  const restarts: string[] = [];
  const h = await renderApp((p) => restarts.push(p));
  try {
    await h.press((i) => i.pressKey("U"));
    expect(restarts).toEqual([]);
    expect(h.frame()).toContain("already up to date");
  } finally {
    await h.cleanup();
  }
});

test("a build older than the one running is not an update", async () => {
  cacheBuild("0.0.1");
  const h = await renderApp(() => {});
  try {
    expect(h.frame()).not.toContain("Update");
  } finally {
    await h.cleanup();
  }
});

test("without the launcher's marker there is no offer, however new the cache", async () => {
  // Run straight off the releases page: a restart into the cache would revert
  // on the next cold start, so the app must not offer one.
  delete process.env.SENTRY_TUI_MANAGED;
  cacheBuild(NEWER);
  const h = await renderApp(() => {});
  try {
    expect(h.frame()).not.toContain("Update");
  } finally {
    await h.cleanup();
  }
});

test("SENTRY_TUI_NO_UPDATE closes the offer too", async () => {
  process.env.SENTRY_TUI_NO_UPDATE = "1";
  cacheBuild(NEWER);
  const h = await renderApp(() => {});
  try {
    expect(h.frame()).not.toContain("Update");
  } finally {
    await h.cleanup();
  }
});
