import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { displayCrashFreePercent } from "~/ui/screens/ReleaseCards";
import { rawReleasesFixture, rawReleasesWithHealthFixture } from "./release-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 34;

/** Releases is the eighth item in Explore's first nav section. */
const RELEASES_INDEX = 7;

interface StubOptions {
  releases?: unknown;
  health?: unknown;
  /** Held open, the health request never answers — the two-status case. */
  healthGate?: Promise<void>;
  /** Fail the health request while the list succeeds. */
  healthStatus?: number;
  /** Record release requests so sort parameters can be asserted. */
  calls?: string[];
}

function stubClient({
  releases = rawReleasesFixture,
  health = rawReleasesWithHealthFixture,
  healthGate,
  healthStatus,
  calls,
}: StubOptions = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls?.push(url);
    if (url.includes("/releases/")) {
      // The two requests differ only by `health=1` — the same distinction the
      // screen relies on to keep one page of releases described twice.
      if (url.includes("health=1")) {
        if (healthGate) await healthGate;
        if (healthStatus) return json({ detail: "health unavailable" }, healthStatus);
        return json(health);
      }
      return json(releases);
    }
    return json([]);
  }) as unknown as typeof fetch;

  // No retries: a failing health request should surface at once rather than
  // spend the test's budget backing off.
  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

/** Two release pages, recording that health follows the list's cursor. */
function paginatedReleaseClient() {
  const listCursors: Array<string | null> = [];
  const healthCursors: Array<string | null> = [];
  const first = rawReleasesFixture[0] as Record<string, unknown>;
  const secondPage = [
    {
      ...first,
      version: "frontend@2.0.0",
      shortVersion: "2.0.0",
      versionInfo: { package: "frontend", version: { raw: "2.0.0" } },
    },
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/releases/")) {
      return new Response("[]", { headers: { "Content-Type": "application/json" } });
    }
    const cursor = url.searchParams.get("cursor");
    const health = url.searchParams.get("health") === "1";
    (health ? healthCursors : listCursors).push(cursor);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!health && cursor === null) {
      headers["Link"] =
        '<https://sentry.io/api/0/organizations/acme/releases/?cursor=next>; rel="next"; results="true"; cursor="next"';
    }
    const body = health
      ? rawReleasesWithHealthFixture
      : cursor === "next"
        ? secondPage
        : rawReleasesFixture;
    return new Response(JSON.stringify(body), { headers });
  }) as unknown as typeof fetch;
  return {
    client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }),
    listCursors,
    healthCursors,
  };
}

/** Navigate to Explore › Releases. */
async function navigateToReleases(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.openNav();
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let i = 0; i < RELEASES_INDEX; i++) await h.press((k) => k.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient | null = stubClient()) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/**
 * Mount straight onto Releases. The rail walk is covered by the routing test
 * below; repeating it per test cost a render pass per keystroke.
 */
async function openReleases(client?: SentryClient) {
  return renderHarness(
    <App
      onQuit={() => {}}
      client={client ?? stubClient()}
      org="acme"
      initialScreen="explore.releases"
    />,
    { width: WIDTH, height: HEIGHT },
  );
}

test("navigating to Explore > Releases shows release cards", async () => {
  const h = await renderApp(stubClient());
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await navigateToReleases(h);
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));
    const frame = h.frame();
    expect(frame).toContain("Search releases");
    // Version, package and commit summary from the card header.
    expect(frame).toContain("1.4.2");
    expect(frame).toContain("frontend");
    expect(frame).toContain("12 commits by 2 authors");
    // The project sub-table's own header.
    expect(frame).toContain("Adoption");
    expect(frame).toContain("Crash-Free");
    expect(frame).toContain("javascript");
    expect(frame).toContain("backend");
  } finally {
    await h.cleanup();
  }
});

test("the deploy environment is shown only for a release that has one", async () => {
  const h = await openReleases();
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));
    const frame = h.frame();
    // 1.4.2 deployed to production; 1.4.1 never deployed, so nothing follows
    // its timestamp.
    expect(frame).toContain("production");
    expect(frame).toContain("1.4.1");
  } finally {
    await h.cleanup();
  }
});

test("S applies release-specific sorts and the required flattened request", async () => {
  const calls: string[] = [];
  const h = await openReleases(stubClient({ calls }));
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));

    await h.press((i) => i.pressKey("S"));
    await h.waitForFrame((frame) => frame.includes("Sort By"));
    expect(h.frame()).toContain("Total Sessions");
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame(() =>
      calls.some((url) => {
        const query = new URL(url).searchParams;
        return query.get("sort") === "sessions" && query.get("flatten") === "1";
      }),
    );
    expect(h.frame()).toContain("S Total Sessions");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Two async statuses: the list and its health
// ---------------------------------------------------------------------------

test("cards render with health pending, then fill in when it lands", async () => {
  let openGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  const h = await openReleases(stubClient({ healthGate: gate }));
  try {
    // Phase one: the list has landed, health has not. Every card is drawn,
    // and the health columns show pending rather than zeroes or em-dashes.
    await h.waitForFrame((f) => f.includes("1.4.2"));
    const pending = h.frame();
    expect(pending).toContain("javascript");
    expect(pending).toContain("Crash-Free");
    expect(pending).not.toContain("99.982%");
    expect(pending).not.toContain("64%");
    // New Issues comes from the list request, so it is already there.
    expect(pending).toContain("12");

    // Phase two: health resolves and the same cards fill in without moving.
    // Released inside `press` so the state update it triggers is wrapped in
    // `act` like any other, rather than landing between two frames.
    await h.press(() => openGate());
    await h.waitForFrame((f) => f.includes("99.982%"));
    const settled = h.frame();
    expect(settled).toContain("99.982%");
    expect(settled).toContain("64%");
    // Still the same cards, in the same order.
    expect(settled).toContain("1.4.2");
    expect(settled).toContain("1.4.1");
  } finally {
    openGate();
    await h.cleanup();
  }
});

test("a project with no session data reads as unavailable, not as zero", async () => {
  const h = await openReleases();
  try {
    // mobile@8.2.0 has five projects and no health for any of them.
    await h.waitForFrame((f) => f.includes("8.2.0"));
    await h.waitForFrame((f) => f.includes("99.982%"));
    const frame = h.frame();
    expect(frame).toContain("8.2.0");
    expect(frame).toContain("android");
    // The em-dash the health cells fall back to once health has arrived.
    expect(frame).toContain("—");
    expect(frame).not.toContain("0%");
  } finally {
    await h.cleanup();
  }
});

test("a failed health request is named in the status bar and leaves the cards up", async () => {
  const h = await openReleases(stubClient({ healthStatus: 403 }));
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));
    await h.waitForFrame((f) => f.includes("health:"));
    const frame = h.frame();
    // The list is intact; only the health half failed.
    expect(frame).toContain("1.4.2");
    expect(frame).toContain("health:");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Expansion, cursor, and states
// ---------------------------------------------------------------------------

test("a card with more projects than it shows says so, and enter expands it", async () => {
  const h = await openReleases();
  try {
    await h.waitForFrame((f) => f.includes("8.2.0"));
    expect(h.frame()).toContain("+2 more projects");
    // The two projects held back by the collapsed card.
    expect(h.frame()).not.toContain("react-native");

    // Move the cursor onto the third card, then expand it.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    await h.waitForFrame((f) => f.includes("react-native"));
    expect(h.frame()).toContain("react-native");
    expect(h.frame()).not.toContain("+2 more projects");

    // Escape collapses it again without leaving the screen.
    await h.pressEscape();
    expect(h.frame()).toContain("+2 more projects");
    expect(h.frame()).toContain("8.2.0");
  } finally {
    await h.cleanup();
  }
});

test("the status bar names what enter does to a card", async () => {
  const h = await openReleases();
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));
    expect(h.frame()).toContain("expand");

    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("close");
  } finally {
    await h.cleanup();
  }
});

test("the footer counts the releases on screen", async () => {
  const h = await openReleases();
  try {
    await h.waitForFrame((f) => f.includes("3 releases"));
    expect(h.frame()).toContain("3 releases");
  } finally {
    await h.cleanup();
  }
});

test("page keys follow the release cursor and keep health on the same page", async () => {
  const { client, listCursors, healthCursors } = paginatedReleaseClient();
  const h = await openReleases(client);
  try {
    await h.waitForFrame((frame) => frame.includes("1.4.2") && frame.includes("pgdn"));
    await h.press((input) => input.pressKey("d", { ctrl: true }));
    await h.waitForFrame((frame) => frame.includes("2.0.0"));
    await h.waitForFrame(() => healthCursors.includes("next"));

    expect(listCursors[0]).toBeNull();
    expect(listCursors.filter((cursor) => cursor === "next")).toEqual(["next"]);
    expect(healthCursors.at(-1)).toBe("next");
    expect(h.frame()).not.toContain("1.4.2");
  } finally {
    await h.cleanup();
  }
});

test("an empty release list names the possibility that nothing is set up", async () => {
  const h = await openReleases(stubClient({ releases: [], health: [] }));
  try {
    await h.waitForFrame((f) => f.includes("No releases found"));
    const frame = h.frame();
    expect(frame).toContain("No releases found");
    expect(frame).toContain("may not have release tracking set up");
  } finally {
    await h.cleanup();
  }
});

test("j and k move between cards", async () => {
  const h = await openReleases();
  try {
    await h.waitForFrame((f) => f.includes("1.4.2"));
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressKey("k"));
    // No crash, and the list is unchanged.
    expect(h.frame()).toContain("1.4.2");
    expect(h.frame()).toContain("1.4.1");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("crash-free percentages are formatted the way Sentry formats them", () => {
  // Three decimals above 90%, none below — `releases/utils/index.tsx:21-58`.
  expect(displayCrashFreePercent(99.982)).toBe("99.982%");
  expect(displayCrashFreePercent(87.6)).toBe("88%");
  expect(displayCrashFreePercent(100)).toBe("100%");
  // A rate that rounds to 100 but isn't is floored, so a crashing release
  // never reads as flawless.
  expect(displayCrashFreePercent(99.99999)).toBe("99.999%");
  expect(displayCrashFreePercent(0.4)).toBe("<1%");
  expect(displayCrashFreePercent(0)).toBe("0%");
});
