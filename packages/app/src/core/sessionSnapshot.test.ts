import { describe, expect, test } from "bun:test";

import {
  APP_SESSION_SNAPSHOT_KIND,
  APP_SESSION_SNAPSHOT_VERSION,
  createAppSessionSnapshot,
  restoreAppSessionSnapshot,
} from "~/core/sessionSnapshot";

function snapshot() {
  return createAppSessionSnapshot({
    org: "acme",
    navigation: {
      location: "https://acme.sentry.io/issues/42/?query=is%3Aunresolved",
      viewStack: ["https://acme.sentry.io/issues/42/"],
      screens: {
        "issues.feed": {
          source: "issues.feed",
          selected: 2,
          query: "is:unresolved",
          sort: "date",
          statsPeriod: "14d",
          selectedProjects: ["backend"],
          selectedEnvs: ["production"],
          detailOpen: false,
        },
      },
    },
    projectsByOrg: { acme: ["backend"] },
    seerCodeModeByOrg: { acme: "only" },
    seerBashModeByOrg: { acme: false },
    seerShowThinkingByOrg: { acme: true },
    seerRunId: 123,
  });
}

describe("app session snapshots", () => {
  test("restores a valid versioned snapshot through canonical URLs", () => {
    const value = snapshot();
    expect(value).toMatchObject({
      kind: APP_SESSION_SNAPSHOT_KIND,
      version: APP_SESSION_SNAPSHOT_VERSION,
    });
    expect(restoreAppSessionSnapshot(JSON.parse(JSON.stringify(value)))).toMatchObject({
      location: { org: "acme", screen: "issues.feed", detail: { issueId: "42" } },
      viewStack: [{ org: "acme", screen: "issues.feed", detail: { issueId: "42" } }],
      snapshot: { seerRunId: 123 },
    });
  });

  test("falls back cleanly for future, malformed, or cross-org snapshots", () => {
    expect(restoreAppSessionSnapshot({ ...snapshot(), version: 2 })).toBeUndefined();
    expect(
      restoreAppSessionSnapshot({
        ...snapshot(),
        navigation: { ...snapshot().navigation, screens: { bad: { entries: [] } } },
      }),
    ).toBeUndefined();
    expect(
      restoreAppSessionSnapshot({
        ...snapshot(),
        navigation: {
          ...snapshot().navigation,
          location: "https://another.sentry.io/issues/42/",
        },
      }),
    ).toBeUndefined();
  });

  test("contains durable state but no fetched response bodies", () => {
    const json = JSON.stringify(snapshot());
    expect(json).toContain('"selected":2');
    expect(json).not.toContain('"entries"');
    expect(json).not.toContain("authToken");
  });
});
