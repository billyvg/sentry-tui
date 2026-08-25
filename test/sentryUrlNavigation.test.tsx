import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { parseSentryUrl, type SentryUrlLocation } from "~/core/sentryUrl";
import { App } from "~/ui/App";
import { eventFixture, groupFixture, groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

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
