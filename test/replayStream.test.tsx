import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import {
  rawReplayErrorRowsFixture,
  rawReplaysFixture,
  replayProjectsFixture,
} from "./replay-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

/** Wide enough for every column, so shedding is opt-in per test. */
const WIDTH = 140;
const HEIGHT = 30;

interface StubOptions {
  replays?: unknown;
  errors?: unknown;
  /** Record every URL the app asked for, to assert the request itself. */
  seen?: string[];
  /** Hold the replay index in flight until this resolves, to see the skeleton. */
  gate?: Promise<void>;
}

function stubClient({
  replays = rawReplaysFixture,
  errors = rawReplayErrorRowsFixture,
  seen,
  gate,
}: StubOptions = {}) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen?.push(url);
    if (url.includes("/replays/")) {
      if (gate) await gate;
      return json({ data: replays });
    }
    if (url.includes("/projects/")) return json(replayProjectsFixture);
    // The replay's error list is a Discover query on the errors dataset.
    if (url.includes("/events/") && url.includes("dataset=errors")) return json({ data: errors });
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl });
}

/** Explore › Replays is the seventh item in the Explore secondary nav. */
async function navigateToReplays(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let step = 0; step < 6; step++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient | null = stubClient(), width = WIDTH) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width,
    height: HEIGHT,
  });
}

/**
 * The replay URL as printed, rejoined across however many lines it took.
 *
 * The pane starts after the 21-cell nav rail; borders and padding come off so
 * the fragments concatenate back into the original string.
 */
function printedUrl(frame: string): string {
  const lines = frame.split("\n").map((line) =>
    line
      .slice(21)
      .replace(/[│┌┐└┘╭╮╰╯]/g, "")
      .trim(),
  );
  const start = lines.findIndex((line) => line.includes("Open it at:"));
  if (start < 0) return "";
  const url: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === "") break;
    url.push(line);
  }
  return url.join("");
}

/** Open the app on Replays with the first page loaded. */
async function openReplays(client?: SentryClient, width?: number) {
  const h = await renderApp(client, width);
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await navigateToReplays(h);
  return h;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

test("navigating to Explore > Replays shows the replay table", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const frame = h.frame();
    expect(frame).toContain("Search replays");
    expect(frame).toContain("Replay");
    expect(frame).toContain("OS");
    expect(frame).toContain("Browser");
    expect(frame).toContain("Duration");
    expect(frame).toContain("Errors");
  } finally {
    await h.cleanup();
  }
});

test("the session cell is two lines: user above project, id and age", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const frame = h.frame();
    expect(frame).toContain("Alice Nguyen");
    // Second line: project slug resolved from project_id, then the short id.
    expect(frame).toContain("javascript · 8a3f2c1d");
  } finally {
    await h.cleanup();
  }
});

test("os, browser and duration are rendered from the nested wire objects", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const frame = h.frame();
    // Major version only — a full "120.0.6099" would not fit the column.
    expect(frame).toContain("Mac OS X 14");
    expect(frame).toContain("Chrome 120");
    // 125 seconds, as a recording's runtime.
    expect(frame).toContain("2:05");
    // 4215 seconds crosses the hour boundary.
    expect(frame).toContain("1:10:15");
    // A sniffed OS range (">=10.15.7") is dropped rather than trimmed to a
    // major that would claim the machine runs macOS 10.
    const anonymous = frame.split("\n").find((line) => line.includes("Anonymous User"))!;
    expect(anonymous).toContain("Mac OS X ");
    expect(anonymous).not.toContain(">=");
    expect(anonymous).not.toContain("Mac OS X 10");
  } finally {
    await h.cleanup();
  }
});

test("a replay with no user reads as an anonymous session", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Anonymous User"));
    expect(h.frame()).toContain("Anonymous User");
  } finally {
    await h.cleanup();
  }
});

test("an archived replay renders as a tombstone rather than a session", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Deleted Replay"));
    const row = h
      .frame()
      .split("\n")
      .find((line) => line.includes("Deleted Replay"))!;
    // The wire sends `null` for every count and for the duration. `Number(null)`
    // is 0, so the row would otherwise claim a zero-second, error-free session.
    expect(row).not.toContain("0:00");
    expect(row).not.toMatch(/\s0\s/);
    expect(row).toContain("—");
  } finally {
    await h.cleanup();
  }
});

test("the status bar counts the replays that loaded", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("6 replays"));
    expect(h.frame()).toContain("6 replays");
  } finally {
    await h.cleanup();
  }
});

test("the empty state says the org may not have replay enabled", async () => {
  const h = await openReplays(stubClient({ replays: [] }));
  try {
    await h.waitForFrame((f) => f.includes("No replays found"));
    const frame = h.frame();
    expect(frame).toContain("No replays found");
    // The screen sits behind a feature flag we cannot read, so an empty page
    // must never be reported as a plain "no results".
    expect(frame).toContain("may not have session replay enabled");
  } finally {
    await h.cleanup();
  }
});

test("the index is fetched from the replays endpoint, newest first", async () => {
  const seen: string[] = [];
  const h = await openReplays(stubClient({ seen }));
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const request = seen.find((url) => url.includes("/organizations/acme/replays/"));
    expect(request).toBeDefined();
    expect(request).toContain("sort=-started_at");
    expect(request).toContain("statsPeriod=14d");
    expect(request).toContain("queryReferrer=replayList");
    // Compound fields are collapsed to their root: the backend cannot be asked
    // for `os.name`, only `os`.
    expect(request).toContain("field=os");
    expect(request).not.toContain("field=os.name");
  } finally {
    await h.cleanup();
  }
});

test("j and k move the cursor through the replay list", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    const frame = h.frame();
    expect(frame).toContain("Alice Nguyen");
    expect(frame).toContain("Anonymous User");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Column shedding
// ---------------------------------------------------------------------------

test("a wide pane restores dead clicks, rage clicks and activity", async () => {
  const h = await openReplays(undefined, 140);
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const frame = h.frame();
    expect(frame).toContain("Dead");
    expect(frame).toContain("Rage");
    expect(frame).toContain("Activity");
  } finally {
    await h.cleanup();
  }
});

test("a narrow pane sheds down to the web's sub-800px column set", async () => {
  const h = await openReplays(undefined, 80);
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    const frame = h.frame();
    // Dropped, in the order the web's container queries drop them.
    expect(frame).not.toContain("Dead");
    expect(frame).not.toContain("Rage");
    expect(frame).not.toContain("Activity");
    // Kept: this is WEB_MAX_800 minus the bulk-select checkbox.
    expect(frame).toContain("Duration");
    expect(frame).toContain("Errors");
    expect(frame).toContain("Browser");
  } finally {
    await h.cleanup();
  }
});

test("a mid-width pane sheds click counts before activity", async () => {
  const h = await openReplays(undefined, 100);
  try {
    await h.waitForFrame((f) => f.includes("8a3f2c1d"));
    const frame = h.frame();
    // Upstream drops both click columns before Activity, so the rightmost of
    // the two goes first as the pane narrows.
    expect(frame).not.toContain("Rage");
    expect(frame).toContain("Dead");
    expect(frame).toContain("Activity");
    // And the session column keeps enough room for a name.
    expect(frame).toContain("Alice Nguyen");
  } finally {
    await h.cleanup();
  }
});

test("every row is exactly two lines tall at every width", async () => {
  for (const width of [80, 100, 140]) {
    const h = await openReplays(undefined, width);
    try {
      await h.waitForFrame((f) => f.includes("8a3f2c1d"));
      const lines = h.frame().split("\n");
      // A row is its session line plus its detail line. An empty `<text>` in
      // a cell — a full or an empty activity bar — used to add a third.
      const first = lines.findIndex((line) => line.includes("Alice Ngu"));
      const last = lines.findIndex((line) => line.includes("f51b8c9d"));
      expect(last - first).toBe(11);
    } finally {
      await h.cleanup();
    }
  }
});

test("the skeleton holds the loaded row's geometry", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await openReplays(stubClient({ gate }));
  try {
    /** Line the column headers sit on, and the line the first row starts on. */
    const anatomy = (frame: string) => {
      const lines = frame.split("\n");
      // The header labels, not the search box's border — several lines are a
      // run of box-drawing rule by the time the table is reached.
      const header = lines.findIndex(
        (line) => line.includes("Browser") && line.includes("Duration"),
      );
      return { header, firstRow: header + 2, lines };
    };

    await h.waitForFrame((f) => f.includes("Search replays"));
    const skeleton = h.frame();
    // The skeleton is drawn from the same resolved columns, so it advertises
    // the same set — including the ones only a wide pane keeps.
    expect(skeleton).toContain("Activity");
    const loading = anatomy(skeleton);
    // Two skeleton lines per row, the same as a real one: the line after the
    // first row's own line is the second half of that row, not a new row.
    expect(loading.lines[loading.firstRow]).toMatch(/─/);
    expect(loading.lines[loading.firstRow + 1]).toMatch(/─/);

    // Through `press` so the resolution and the React work it schedules are
    // settled inside the same `act()` the harness uses for input.
    await h.press(() => release());
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));

    // Nothing above or inside the table moved when the data landed.
    const loaded = anatomy(h.frame());
    expect(loaded.header).toBe(loading.header);
    expect(loaded.lines[loaded.firstRow]).toContain("Alice Nguyen");
    expect(loaded.lines[loaded.firstRow + 1]).toContain("8a3f2c1d");
  } finally {
    await h.cleanup();
  }
});

test("no row overflows the pane at any width", async () => {
  for (const width of [80, 100, 140]) {
    const h = await openReplays(undefined, width);
    try {
      // The short id is on the full-width detail line, so it survives every
      // width the Session column does not.
      await h.waitForFrame((f) => f.includes("8a3f2c1d"));
      for (const line of h.frame().split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    } finally {
      await h.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

test("enter pushes a detail view with the replay's metadata", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("Replays / 8a3f2c1d"));
    const frame = h.frame();
    expect(frame).toContain("Replays / 8a3f2c1d");
    expect(frame).toContain("2:05");
    expect(frame).toContain("Mac OS X 14 · Chrome 120");
    expect(frame).toContain("4 dead · 1 rage");
    expect(frame).toContain("frontend@1.4.2");
  } finally {
    await h.cleanup();
  }
});

test("the detail view is honest about playback and offers the browser link", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("Playback is not available"));
    const frame = h.frame();
    expect(frame).toContain("Playback is not available in a terminal");
    // The whole URL must survive at every width, split across lines when it
    // has to — a URL missing its middle is worse than no URL. Adjacent
    // soft-wrapping text nodes used to overwrite each other's tails.
    expect(printedUrl(frame)).toBe(
      "https://sentry.io/organizations/acme/explore/replays/8a3f2c1d9e4b4f7a8c1d2e3f4a5b6c7d/",
    );
  } finally {
    await h.cleanup();
  }
});

test("the replay URL survives intact at 80 columns, where it must wrap", async () => {
  const h = await openReplays(undefined, 80);
  try {
    await h.waitForFrame((f) => f.includes("8a3f2c1d"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Playback is not available"));

    expect(printedUrl(h.frame())).toBe(
      "https://sentry.io/organizations/acme/explore/replays/8a3f2c1d9e4b4f7a8c1d2e3f4a5b6c7d/",
    );
  } finally {
    await h.cleanup();
  }
});

test("the detail view lists the replay's errors", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("JAVASCRIPT-2A"));
    const frame = h.frame();
    expect(frame).toContain("JAVASCRIPT-2A");
    expect(frame).toContain("NetworkError: Failed to fetch");
    expect(frame).toContain("14:03:19");
  } finally {
    await h.cleanup();
  }
});

test("the error list is queried for this replay alone", async () => {
  const seen: string[] = [];
  const h = await openReplays(stubClient({ seen }));
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("JAVASCRIPT-2A"));

    const request = seen.find((url) => url.includes("dataset=errors"));
    expect(request).toBeDefined();
    expect(decodeURIComponent(request!)).toContain("replayId:[8a3f2c1d9e4b4f7a8c1d2e3f4a5b6c7d]");
  } finally {
    await h.cleanup();
  }
});

test("a replay with no errors says so without asking the API", async () => {
  const seen: string[] = [];
  const h = await openReplays(stubClient({ seen }));
  try {
    await h.waitForFrame((f) => f.includes("Ben Okafor"));
    // The second fixture replay reports zero errors.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("No errors in this replay"));
    expect(h.frame()).toContain("No errors in this replay");
    expect(seen.some((url) => url.includes("dataset=errors"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

test("escape pops the detail view back to the index", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Playback is not available"));

    await h.pressEscape();

    await h.waitForFrame((f) => f.includes("Search replays"));
    const frame = h.frame();
    expect(frame).toContain("Search replays");
    expect(frame).not.toContain("Playback is not available");
  } finally {
    await h.cleanup();
  }
});

test("the detail view keeps a filter row, so P cannot trap the keyboard", async () => {
  const h = await openReplays();
  try {
    await h.waitForFrame((f) => f.includes("Alice Nguyen"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Playback is not available"));

    await h.press((i) => i.pressKey("P", { shift: true }));
    expect(h.frame()).toContain("Project");

    // The dropdown must be closable, or every key after it is swallowed.
    await h.pressEscape();
    expect(h.frame()).toContain("Playback is not available");
  } finally {
    await h.cleanup();
  }
});
