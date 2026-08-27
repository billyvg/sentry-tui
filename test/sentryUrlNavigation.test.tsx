import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { parseSentryUrl, type SentryUrlLocation } from "~/core/sentryUrl";
import { App } from "~/ui/App";
import { eventFixture, groupFixture, groupsFixture, savedViewsFixture } from "./fixtures";
import { renderHarness } from "./helpers";
import { rawExploreSavedQueriesFixture, savedQueryResultRowsFixture } from "./saved-query-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

function location(url: string): SentryUrlLocation {
  const result = parseSentryUrl(url);
  if (result.kind !== "location") throw new Error(result.message);
  return result.location;
}

function stubClient(seen: string[]) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("issues-stats")) return json({});
    if (url.includes("/issues/1/events/deadbeef/")) return json(eventFixture);
    if (new URL(url).pathname.endsWith("/issues/1/")) return json(groupFixture);
    if (url.includes("/issues/?")) return json(groupsFixture);
    if (new URL(url).pathname.endsWith("/organizations/acme/")) {
      return json({ id: "1", slug: "acme", name: "Acme" });
    }
    return json([]);
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

test("an initial URL selects its screen and seeds common filters before the first request", async () => {
  const seen: string[] = [];
  const initialLocation = location(
    "https://acme.sentry.io/issues/?query=level%3Afatal&project=3&environment=production&statsPeriod=24h&sort=freq",
  );
  const h = await renderHarness(
    <App onQuit={() => {}} client={stubClient(seen)} initialLocation={initialLocation} />,
    { width: 120, height: 30 },
  );

  try {
    await h.waitForFrame((frame) => frame.includes("TypeError"));
    const request = seen.find((url) => url.includes("/issues/?"));
    expect(request).toBeDefined();
    const params = new URL(request!).searchParams;
    expect(params.get("query")).toBe("level:fatal");
    expect(params.getAll("project")).toEqual(["3"]);
    expect(params.getAll("environment")).toEqual(["production"]);
    expect(params.get("statsPeriod")).toBe("24h");
    expect(params.get("sort")).toBe("freq");
  } finally {
    await h.cleanup();
  }
});

test("an initial issue-event URL resolves the issue and opens that exact event", async () => {
  const seen: string[] = [];
  const initialLocation = location("https://acme.sentry.io/issues/1/events/deadbeef/");
  const h = await renderHarness(
    <App onQuit={() => {}} client={stubClient(seen)} initialLocation={initialLocation} />,
    { width: 120, height: 30 },
  );

  try {
    await h.waitForFrame((frame) => frame.includes("Issues › Feed › PUMP-STATION-1"));
    expect(
      seen.some((url) => new URL(url).pathname.endsWith("/organizations/acme/issues/1/")),
    ).toBe(true);
    expect(seen.some((url) => url.includes("/issues/1/events/deadbeef/"))).toBe(true);

    // Hydrating the stack entry also restores the ordinary issue-action scope.
    await h.press((input) => input.pressKey("k", { ctrl: true }));
    await h.press((input) => input.pressKey("resolve"));
    expect(h.frame()).toContain("Resolve");
  } finally {
    await h.cleanup();
  }
});

test("saved-resource URLs reconstruct their existing TUI result views", async () => {
  const seen: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/group-search-views/10/")) return json(savedViewsFixture.mine[0]);
    if (path.endsWith("/explore/saved/501/")) return json(rawExploreSavedQueriesFixture[0]);
    if (path.endsWith("/events/")) return json({ data: savedQueryResultRowsFixture });
    if (path.endsWith("/issues/")) return json(groupsFixture);
    if (path.includes("issues-stats")) return json({});
    return json([]);
  }) as unknown as typeof fetch;
  const client = new SentryClient({ auth, fetchImpl, maxRetries: 0 });

  const viewHarness = await renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      initialLocation={location("https://acme.sentry.io/issues/views/10/")}
    />,
    { width: 120, height: 30 },
  );
  try {
    await viewHarness.waitForFrame((frame) => frame.includes("Prod errors"));
    expect(seen.some((url) => url.includes("/group-search-views/10/"))).toBe(true);
  } finally {
    await viewHarness.cleanup();
  }

  const queryHarness = await renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      initialLocation={location(
        "https://acme.sentry.io/explore/traces/?id=501&dataset=spans&title=Slow+checkout+spans",
      )}
    />,
    { width: 120, height: 30 },
  );
  try {
    await queryHarness.waitForFrame((frame) => frame.includes("POST /api/checkout"));
    expect(seen.some((url) => url.includes("/explore/saved/501/"))).toBe(true);
  } finally {
    await queryHarness.cleanup();
  }
});

test("W opens the current screen's canonical production URL", async () => {
  const opened: string[] = [];
  const h = await renderHarness(
    <App
      onQuit={() => {}}
      org="acme"
      initialScreen="explore.logs"
      onOpenUrl={(url) => (opened.push(url), true)}
    />,
  );

  try {
    await h.press((input) => input.pressKey("W"));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.origin).toBe("https://acme.sentry.io");
    expect(url.pathname).toBe("/explore/logs/");
    expect(url.searchParams.get("statsPeriod")).toBe("1h");
  } finally {
    await h.cleanup();
  }
});

test("a failed browser launch leaves the canonical URL on screen", async () => {
  const h = await renderHarness(
    <App onQuit={() => {}} org="acme" initialScreen="monitors.uptime" onOpenUrl={() => false} />,
  );

  try {
    await h.press((input) => input.pressKey("W"));
    await h.waitForFrame((frame) => frame.includes("Could not launch a browser"));
    expect(h.frame()).toContain("https://acme.sentry.io/monitors/uptime/");
  } finally {
    await h.cleanup();
  }
});
