import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { getScreen } from "~/core/screens";
import { SPARKLINE_PENDING } from "~/lib/sparkline";
import { useScreenState } from "~/ui/hooks/useScreenState";
import { IssueFeed } from "~/ui/screens/IssueFeed";
import { groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 100;
const HEIGHT = 30;
const EMPTY_PROJECTS: string[] = [];
const EMPTY_PENDING_IDS = new Set<string>();

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/**
 * A client whose list and stats responses are released by hand, so each phase
 * of the two-phase fetch can be observed on its own.
 */
function deferredClient() {
  let releaseList!: () => void;
  let releaseStats!: () => void;
  const listGate = new Promise<void>((r) => (releaseList = r));
  const statsGate = new Promise<void>((r) => (releaseStats = r));

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("issues-stats")) {
      await statsGate;
      // An *array* of entries carrying their own id — the real response shape.
      // Counts live here too, because collapse=stats strips them from the list.
      return json([
        {
          id: "1",
          count: "1428",
          userCount: 92,
          lastSeen: groupsFixture[0]!.lastSeen,
          stats: {
            "24h": [
              [0, 1],
              [1, 9],
              [2, 4],
            ],
          },
        },
        {
          id: "2",
          count: "312",
          userCount: 41,
          stats: {
            "24h": [
              [0, 2],
              [1, 3],
              [2, 1],
            ],
          },
        },
        {
          id: "3",
          count: "58",
          userCount: 7,
          stats: {
            "24h": [
              [0, 0],
              [1, 1],
              [2, 0],
            ],
          },
        },
      ]);
    }
    await listGate;
    // Mirror the API: collapse=stats omits the graph series *and* the counts.
    return json(groupsFixture.map(({ stats: _s, count: _c, userCount: _u, ...rest }) => rest));
  }) as unknown as typeof fetch;

  return {
    client: new SentryClient({ auth, fetchImpl }),
    releaseList,
    releaseStats,
  };
}

/** Render the issue screen through the same state contract the app supplies. */
function IssueFeedHarness({ client }: { client: SentryClient | null }) {
  const { active: state } = useScreenState("issues.feed", "issues.feed", EMPTY_PROJECTS);
  return (
    <IssueFeed
      client={client}
      org="acme"
      screen={getScreen("issues.feed")}
      state={state}
      width={WIDTH}
      height={HEIGHT}
      focused
      reloadToken={0}
      onProjectSelect={(projects) =>
        state.dispatch({ type: "setSelectedProjects", payload: projects })
      }
      pendingIds={EMPTY_PENDING_IDS}
      runIssueAction={() => {}}
      openIssueAutofix={() => {}}
      pushView={() => {}}
      notify={() => {}}
      activateRow={() => {}}
      registerActions={() => {}}
      updateView={() => {}}
      navigateToScreen={() => {}}
    />
  );
}

const render = (client: SentryClient | null) =>
  renderHarness(<IssueFeedHarness client={client} />, { width: WIDTH, height: HEIGHT });

test("shows skeleton rows immediately on a cold load", async () => {
  const { client } = deferredClient(); // never released
  const h = await render(client);
  try {
    const frame = h.frame();
    // Skeleton placeholders, not a blank screen or a lone spinner.
    expect(frame).toContain("╌");
    expect(frame).toContain("··");
    expect(frame).not.toContain("No issues match");
  } finally {
    await h.cleanup();
  }
});

test("renders text before sparklines — the point of the two-phase fetch", async () => {
  const { client, releaseList, releaseStats } = deferredClient();
  const h = await render(client);
  try {
    await h.press(() => releaseList());
    await h.waitForFrame((f) => f.includes("TypeError"));

    // List has landed; stats have not. Counts show a placeholder rather than
    // a fabricated 0 — an absent count is pending, not zero.
    const afterList = h.frame();
    expect(afterList).toContain("TypeError");
    expect(afterList).toContain("PUMP-STATION-1");
    expect(afterList).toContain(SPARKLINE_PENDING);
    expect(afterList).toContain("··");
    expect(afterList).not.toContain("1.4k");

    await h.press(() => releaseStats());
    await h.waitForFrame((f) => !f.includes(SPARKLINE_PENDING));

    const afterStats = h.frame();
    expect(afterStats).toContain("TypeError"); // rows unchanged
    expect(afterStats).not.toContain(SPARKLINE_PENDING);
    // collapse=stats strips the counts as well as the graphs, so phase two
    // fills in both.
    expect(afterStats).toContain("1.4k");
  } finally {
    await h.cleanup();
  }
});

test("renders the empty state only once the load has settled", async () => {
  const fetchImpl = (async () => json([])) as unknown as typeof fetch;
  const client = new SentryClient({ auth, fetchImpl });

  const h = await render(client);
  try {
    await h.waitForFrame((f) => f.includes("No issues match"));
    expect(h.frame()).toContain("No issues match this search.");
  } finally {
    await h.cleanup();
  }
});

test("a failed load renders an in-place retryable error", async () => {
  const fetchImpl = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
  const client = new SentryClient({ auth, fetchImpl });

  const h = await render(client);
  try {
    await h.waitForFrame((f) => f.includes("Failed to load issues"));
    const frame = h.frame();
    expect(frame).toContain("Failed to load issues");
    // The message soft-wraps, so match against the unwrapped text.
    expect(frame.replace(/\s+/g, " ")).toContain("is invalid or expired");
    // 401 is not retryable, so no retry affordance is advertised.
    expect(frame).not.toContain("to retry");
  } finally {
    await h.cleanup();
  }
});

test("a retryable failure offers a retry key", async () => {
  const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  const client = new SentryClient({ auth, fetchImpl, maxRetries: 0 });

  const h = await render(client);
  try {
    await h.waitForFrame((f) => f.includes("Failed to load issues"));
    expect(h.frame()).toContain("to retry");
  } finally {
    await h.cleanup();
  }
});

test("renders the header chrome regardless of load state", async () => {
  const h = await render(null);
  try {
    const frame = h.frame();
    expect(frame).toContain("is:unresolved"); // default query
    expect(frame).toContain("S Last Seen");
    expect(frame).not.toContain("Sort:");
    expect(frame).toContain("14d");
  } finally {
    await h.cleanup();
  }
});
