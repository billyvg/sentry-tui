import { describe, expect, test } from "bun:test";

import { SCREENS } from "~/core/screens";
import { buildSentryUrl, parseSentryUrl, type SentryUrlLocation } from "~/core/sentryUrl";

describe("parseSentryUrl", () => {
  test("parses canonical and customer-domain organization URLs", () => {
    expect(parseSentryUrl("https://sentry.io/organizations/acme/issues/inbox/")).toEqual({
      kind: "location",
      location: { org: "acme", screen: "issues.inbox", state: undefined },
    });
    expect(parseSentryUrl("https://acme.sentry.io/explore/logs/")).toEqual({
      kind: "location",
      location: { org: "acme", screen: "explore.logs", state: undefined },
    });
  });

  test("routes every supported top-level product family", () => {
    const cases = [
      ["issues/errors-outages/", "issues.errors-outages"],
      ["explore/traces/", "explore.traces"],
      ["explore/agents/", "explore.conversations"],
      ["explore/saved-queries/", "explore.all-queries"],
      ["dashboards/", "dashboards.all"],
      ["dashboards/?filter=onlyPrebuilt", "dashboards.sentry-built"],
      ["monitors/my-monitors/", "monitors.mine"],
      ["monitors/alerts/", "monitors.alerts"],
      ["issues/alerts/", "monitors.alerts"],
    ] as const;

    for (const [path, screen] of cases) {
      const result = parseSentryUrl(`https://sentry.io/organizations/acme/${path}`);
      expect(result.kind).toBe("location");
      if (result.kind === "location") expect(result.location.screen).toBe(screen);
    }
  });

  test("routes identifiers to their existing detail views", () => {
    const cases = [
      ["issues/42/", { kind: "issue", issueId: "42" }],
      ["issues/42/events/abc123/", { kind: "issue", issueId: "42", eventId: "abc123" }],
      ["dashboard/101/", { kind: "dashboard", dashboardId: "101" }],
      ["explore/replays/a1b2/", { kind: "replay", replayId: "a1b2" }],
      ["monitors/7/", { kind: "monitor", detectorId: "7" }],
    ] as const;

    for (const [path, detail] of cases) {
      const result = parseSentryUrl(`https://sentry.io/organizations/acme/${path}`);
      expect(result.kind).toBe("location");
      if (result.kind === "location") expect(result.location.detail).toEqual(detail);
    }
  });

  test("carries common page filters without keeping the raw URL", () => {
    const result = parseSentryUrl(
      "https://acme.sentry.io/issues/?query=is%3Aunresolved&project=1&project=2&environment=prod&statsPeriod=24h&sort=freq",
    );
    expect(result).toEqual({
      kind: "location",
      location: {
        org: "acme",
        screen: "issues.feed",
        state: {
          query: "is:unresolved",
          selectedProjects: ["1", "2"],
          selectedEnvs: ["prod"],
          statsPeriod: "24h",
          sort: "freq",
        },
      },
    });
  });

  test("uses the Discover dataset to choose the matching TUI screen", () => {
    const result = parseSentryUrl(
      "https://acme.sentry.io/explore/discover/results/?dataset=tracemetrics",
    );
    expect(result.kind === "location" && result.location.screen).toBe("explore.metrics");
  });

  test("distinguishes invalid input from valid but unsupported Sentry pages", () => {
    expect(parseSentryUrl("not a url")).toMatchObject({
      kind: "invalid",
      reason: "malformed",
    });
    expect(parseSentryUrl("http://acme.sentry.io/issues/")).toMatchObject({
      kind: "invalid",
      reason: "protocol",
    });
    expect(parseSentryUrl("https://example.com/organizations/acme/issues/")).toMatchObject({
      kind: "invalid",
      reason: "host",
    });
    expect(parseSentryUrl("https://acme.sentry.io/settings/projects/")).toMatchObject({
      kind: "unsupported",
      family: "settings",
    });
    expect(parseSentryUrl("https://acme.sentry.io/explore/traces/trace/abc/")).toMatchObject({
      kind: "unsupported",
      family: "explore",
    });
  });

  test("rejects missing and conflicting organizations", () => {
    expect(parseSentryUrl("https://sentry.io/issues/")).toMatchObject({
      kind: "invalid",
      reason: "organization",
    });
    expect(parseSentryUrl("https://acme.sentry.io/organizations/globex/issues/")).toMatchObject({
      kind: "invalid",
      reason: "organization_mismatch",
    });
  });
});

describe("buildSentryUrl", () => {
  test("every TUI screen has a canonical production URL that routes back", () => {
    for (const screen of SCREENS) {
      const url = buildSentryUrl({ org: "acme", screen: screen.id });
      expect(url).toStartWith("https://acme.sentry.io/");

      const parsed = parseSentryUrl(url);
      expect(parsed.kind).toBe("location");
      if (parsed.kind === "location") expect(parsed.location.screen).toBe(screen.id);
    }
  });

  test("writes common filters and resource details", () => {
    const url = new URL(
      buildSentryUrl({
        org: "acme",
        screen: "issues.inbox",
        detail: { kind: "issue", issueId: "42", eventId: "abc/123" },
        state: {
          query: "is:unresolved",
          selectedProjects: ["1", "2"],
          selectedEnvs: ["prod"],
          statsPeriod: "24h",
          sort: "freq",
        },
      }),
    );

    expect(url.pathname).toBe("/issues/42/events/abc%2F123/");
    expect(url.searchParams.get("query")).toBe("is:unresolved");
    expect(url.searchParams.getAll("project")).toEqual(["1", "2"]);
    expect(url.searchParams.getAll("environment")).toEqual(["prod"]);
    expect(url.searchParams.get("statsPeriod")).toBe("24h");
    expect(url.searchParams.get("sort")).toBe("freq");
  });

  test("round-trips saved views and saved query results", () => {
    const cases: SentryUrlLocation[] = [
      {
        org: "acme",
        screen: "issues.all-views",
        detail: { kind: "issue_view", viewId: "10" },
      },
      {
        org: "acme",
        screen: "explore.logs",
        detail: {
          kind: "saved_query",
          queryId: "502",
          source: "explore",
          resultScreen: "explore.logs",
          dataset: "logs",
          title: "Billing errors",
        },
        state: { fields: ["timestamp", "message"] },
      },
    ];

    for (const location of cases) {
      const parsed = parseSentryUrl(buildSentryUrl(location));
      expect(parsed).toMatchObject({
        kind: "location",
        location: { screen: location.screen, detail: location.detail },
      });
    }
  });

  test("deep-links an active Seer run through production's global drawer", () => {
    const url = new URL(buildSentryUrl({ org: "acme", screen: "seer.ask", seerRunId: "run-123" }));
    expect(url.pathname).toBe("/issues/");
    expect(url.searchParams.get("explorerRunId")).toBe("run-123");
    expect(parseSentryUrl(url.toString())).toMatchObject({
      kind: "location",
      location: { org: "acme", screen: "seer.ask", seerRunId: "run-123" },
    });
  });
});
