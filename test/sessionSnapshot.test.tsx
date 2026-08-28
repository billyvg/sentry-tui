import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { AppSessionSnapshot } from "~/core/sessionSnapshot";
import { parseSentryUrl, type SentryUrlLocation } from "~/core/sentryUrl";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

function location(url: string): SentryUrlLocation {
  const result = parseSentryUrl(url);
  if (result.kind !== "location") throw new Error(result.message);
  return result.location;
}

function stubClient() {
  const urls: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.includes("issues-stats")) return json({});
    if (path.endsWith("/issues/2/")) return json(groupsFixture[1]);
    if (path.endsWith("/issues/")) return json(groupsFixture);
    if (path.endsWith("/organizations/acme/")) {
      return json({ id: "1", slug: "acme", name: "Acme", features: [] });
    }
    return json([]);
  }) as unknown as typeof fetch;
  return { urls, client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }) };
}

test("a payload remount restores org, location, filters, cursor, and detail stack", async () => {
  const { client, urls } = stubClient();
  let snapshot: AppSessionSnapshot | undefined;
  const initialLocation = location(
    "https://acme.sentry.io/issues/?query=is%3Aunresolved+marker&project=3&environment=production&statsPeriod=24h&sort=date",
  );
  const first = await renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      initialLocation={initialLocation}
      onSessionSnapshot={(value) => {
        snapshot = value as AppSessionSnapshot;
      }}
    />,
    { width: 120, height: 30 },
  );

  try {
    await first.waitForFrame((frame) => frame.includes("ValueError"));
    await first.press((input) => input.pressKey("j"));
    await first.press((input) => input.pressEnter());
    await first.waitForFrame((frame) => frame.includes("PUMP-STATION-2"));

    expect(snapshot?.org).toBe("acme");
    expect(snapshot?.navigation.viewStack).toHaveLength(1);
    expect(snapshot?.navigation.screens["issues.feed"]).toMatchObject({
      source: "issues.feed",
      selected: 1,
      query: "is:unresolved marker",
      selectedProjects: ["3"],
      selectedEnvs: ["production"],
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("ValueError: invalid literal");
    expect(json).not.toContain("sntryu_test");
  } finally {
    await first.cleanup();
  }

  urls.length = 0;
  const restored = await renderHarness(
    <App
      onQuit={() => {}}
      client={client}
      org="ignored"
      initialScreen="monitors.all"
      initialSessionSnapshot={snapshot}
    />,
    { width: 120, height: 30 },
  );

  try {
    await restored.waitForFrame((frame) => frame.includes("PUMP-STATION-2"));
    expect(urls.some((url) => new URL(url).pathname.endsWith("/issues/2/"))).toBe(true);

    await restored.pressEscape();
    await restored.waitForFrame((frame) => frame.includes("ValueError"));
    expect(restored.frame()).toContain("is:unresolved marker");
    const selectedRow = restored
      .frame()
      .split("\n")
      .find((line) => line.includes("ValueError"));
    expect(selectedRow).toContain("▸");

    const issueRequest = urls.find((url) => new URL(url).pathname.endsWith("/issues/"));
    expect(issueRequest).toBeDefined();
    expect(new URL(issueRequest!).searchParams.get("query")).toBe("is:unresolved marker");
  } finally {
    await restored.cleanup();
  }
});
