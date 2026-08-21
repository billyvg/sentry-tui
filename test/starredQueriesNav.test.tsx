/**
 * Explore › Starred Queries — the dynamic nav section.
 *
 * The failure mode this guards against is not a missing section but a broken
 * sidebar: the fetch runs in the background while someone is trying to
 * navigate, so an empty answer, a slow one and a 403 all have to leave the
 * static IA intact and the cursor working.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { MAX_STARRED_SAVED_QUERIES_IN_NAV } from "~/api/savedQueries";
import { App } from "~/ui/App";
import { useSecondaryNavExtras } from "~/ui/hooks/useSecondaryNavExtras";
import { renderHarness } from "./helpers";
import { rawExploreSavedQueriesFixture } from "./saved-query-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** A starred-query response of `count` distinctly named queries. */
function starredQueries(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    name: `starred ${i}`,
    dataset: "spans",
    projects: [],
    environment: [],
    starred: true,
    query: [{ fields: ["id"], mode: "samples", orderby: "-timestamp", query: "" }],
  }));
}

function stubClient(saved: unknown = rawExploreSavedQueriesFixture, status = 200) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    // `starred=1` filters server-side, so the stub does too — the nav must not
    // be relying on a filter the endpoint already applied.
    const starredOnly = url.includes("starred=1");
    const body = url.includes("/explore/saved/")
      ? (saved as Array<{ starred?: boolean }>).filter((q) => !starredOnly || q.starred === true)
      : [];
    return new Response(JSON.stringify(body), {
      status: url.includes("/explore/saved/") ? status : 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }), urls };
}

/** Move the rail cursor to Explore and open its sidebar, leaving it open. */
async function openExploreSidebar(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function renderApp(client: SentryClient) {
  return renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

test("starred queries appear as their own section below All Queries", async () => {
  const { client, urls } = stubClient();
  const h = await renderApp(client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Starred Queries"));

    const frame = h.frame();
    expect(frame).toContain("Starred Queries");
    // The two starred fixture queries, and not the unstarred one.
    expect(frame).toContain("Slow checkout");
    expect(frame).toContain("Billing errors");
    expect(frame).not.toContain("Sentry p95");
    // Below the static IA, as the web draws it.
    expect(frame.indexOf("All Queries")).toBeLessThan(frame.indexOf("Starred Queries"));

    // The request is the web's: starred only, capped at the nav's own limit.
    const saved = urls.find((url) => url.includes("/explore/saved/"));
    expect(saved).toContain("starred=1");
    expect(saved).toContain(`per_page=${MAX_STARRED_SAVED_QUERIES_IN_NAV}`);
  } finally {
    await h.cleanup();
  }
});

test("selecting a starred query opens All Queries", async () => {
  const h = await renderApp(stubClient().client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Starred Queries"));

    // Walk the cursor down to the first starred item: nine static Explore
    // items sit above All Queries, which sits above the section.
    for (let n = 0; n < 10; n++) await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());

    // A starred item has no screen of its own, so it lands on the list that
    // can run it rather than on the placeholder pane.
    await h.waitForFrame((f) => f.includes("Saved Explore queries"));
    expect(h.frame()).not.toContain("Not implemented yet");
  } finally {
    await h.cleanup();
  }
});

test("nothing starred means no section, and the static nav is untouched", async () => {
  const h = await renderApp(stubClient([]).client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Traces"));

    const frame = h.frame();
    expect(frame).not.toContain("Starred Queries");
    expect(frame).toContain("Traces");
    expect(frame).toContain("All Queries");

    // The cursor still walks the static list and commits.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Search logs"));
  } finally {
    await h.cleanup();
  }
});

test("a failed starred-query fetch costs a section, not the nav", async () => {
  const h = await renderApp(stubClient([], 403).client);
  try {
    await openExploreSidebar(h);
    await h.waitForFrame((f) => f.includes("Traces"));

    const frame = h.frame();
    expect(frame).not.toContain("Starred Queries");
    // Nothing about the failure leaks into the sidebar.
    expect(frame).not.toContain("Forbidden");

    // And the sidebar still navigates.
    await h.press((i) => i.pressKey("j"));
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => f.includes("Search logs"));
  } finally {
    await h.cleanup();
  }
});

test("the sidebar for another group does not pay for Explore's fetch", async () => {
  const { client, urls } = stubClient();
  const h = await renderApp(client);
  try {
    await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
    // Issues is the group on screen at start.
    expect(urls.some((url) => url.includes("/explore/saved/"))).toBe(false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The cap, read straight off the hook
// ---------------------------------------------------------------------------

/** Prints what the hook returns, so the cap can be asserted past the viewport. */
function ExtrasProbe({ client }: { client: SentryClient }) {
  const extras = useSecondaryNavExtras(client, "acme", "explore", 0);
  const section = extras.sections[0];
  return <text>{`items=${section?.items.length ?? 0} title=${section?.title ?? "none"}`}</text>;
}

test("the section is capped at MAX_STARRED_SAVED_QUERIES_IN_NAV", async () => {
  // More than the cap, in case the endpoint ignores `per_page`.
  const { client } = stubClient(starredQueries(MAX_STARRED_SAVED_QUERIES_IN_NAV + 5));
  const h = await renderHarness(<ExtrasProbe client={client} />, { width: 60, height: 4 });
  try {
    await h.waitForFrame((f) => f.includes("items="));
    await h.waitForFrame((f) => !f.includes("items=0"));
    expect(h.frame()).toContain(`items=${MAX_STARRED_SAVED_QUERIES_IN_NAV}`);
    expect(h.frame()).toContain("title=Starred Queries");
  } finally {
    await h.cleanup();
  }
});
