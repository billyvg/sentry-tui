import { describe, expect, test } from "bun:test";

import {
  parameterizePath,
  safeQuery,
  scrubEvent,
  scrubSecrets,
} from "@sentry-tui/runtime-host/telemetry/scrub";

describe("scrubSecrets", () => {
  test("redacts Sentry auth tokens", () => {
    expect(scrubSecrets("Unauthorized — the token sntryu_abc123DEF is invalid.")).toBe(
      "Unauthorized — the token [redacted] is invalid.",
    );
    expect(scrubSecrets("using sntrys_xyz-789_abc")).toBe("using [redacted]");
  });

  test("redacts an Authorization header value but keeps the shape", () => {
    expect(scrubSecrets("Authorization: Bearer eyJhbGciOi.J9.sig")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  test("redacts credentials echoed back in a JSON body", () => {
    const body = 'HTTP 400: {"access_token": "abc", "error": "invalid_grant"}';
    expect(scrubSecrets(body)).toBe(
      'HTTP 400: {"access_token":"[redacted]", "error": "invalid_grant"}',
    );
  });

  test("collapses a home directory, which carries the account name", () => {
    expect(scrubSecrets("at /Users/somebody/code/sentry-tui/src/ui/App.tsx:12")).toBe(
      "at ~/code/sentry-tui/src/ui/App.tsx:12",
    );
    expect(scrubSecrets("at /home/somebody/sentry-tui/src/main.tsx")).toBe(
      "at ~/sentry-tui/src/main.tsx",
    );
  });

  test("leaves ordinary text alone", () => {
    const message = "Not found — check the organization or project slug.";
    expect(scrubSecrets(message)).toBe(message);
  });
});

describe("parameterizePath", () => {
  test.each([
    ["/organizations/acme/issues/", "/organizations/{org}/issues/"],
    ["/organizations/acme/issues/4815162342/", "/organizations/{org}/issues/{id}/"],
    ["/projects/acme/frontend/events/", "/projects/{org}/{project}/events/"],
    ["/organizations/acme/releases/1.2.3/", "/organizations/{org}/releases/{version}/"],
    ["/issues/4815162342/events/latest/", "/issues/{id}/events/latest/"],
    ["/teams/acme/platform/members/", "/teams/{org}/{team}/members/"],
  ])("%s → %s", (path, expected) => {
    expect(parameterizePath(path)).toBe(expected);
  });

  test("collapses hex and uuid identifiers too", () => {
    expect(parameterizePath("/replays/0123456789abcdef0123456789abcdef/")).toBe("/replays/{id}/");
    expect(parameterizePath("/replays/3fa85f64-5717-4562-b3fc-2c963f66afa6/")).toBe(
      "/replays/{id}/",
    );
  });

  test("drops the query string", () => {
    expect(parameterizePath("/organizations/acme/issues/?query=is:unresolved")).toBe(
      "/organizations/{org}/issues/",
    );
  });
});

describe("safeQuery", () => {
  test("keeps the shape of the request", () => {
    expect(safeQuery("?statsPeriod=14d&sort=freq&limit=25")).toEqual({
      statsPeriod: "14d",
      sort: "freq",
      limit: "25",
    });
  });

  test("never keeps what the user typed", () => {
    expect(safeQuery("?query=is:unresolved+billing&statsPeriod=24h")).toEqual({
      statsPeriod: "24h",
    });
  });

  test("handles an absent or empty query", () => {
    expect(safeQuery(undefined)).toEqual({});
    expect(safeQuery("")).toEqual({});
  });
});

describe("scrubEvent", () => {
  test("drops the hostname the SDK fills in", () => {
    expect(scrubEvent({ server_name: "someones-laptop.local" }).server_name).toBeUndefined();
  });

  test("scrubs exception values, frames, breadcrumbs and extra", () => {
    const event = scrubEvent({
      message: "failed with sntryu_secret",
      exception: {
        values: [
          {
            value: "HTTP 500: token sntryu_secret",
            stacktrace: {
              frames: [
                { filename: "/Users/somebody/code/sentry-tui/src/api/client.ts" },
                { filename: "node_modules/@sentry/core/index.js" },
              ],
            },
          },
        ],
      },
      breadcrumbs: [{ message: "GET /x with sntryu_secret", data: { url: "sntryu_secret" } }],
      extra: { detail: "sntryu_secret", count: 3 },
    });

    expect(event.message).toBe("failed with [redacted]");
    expect(event.exception?.values?.[0]?.value).toBe("HTTP 500: token [redacted]");
    expect(event.breadcrumbs?.[0]?.message).toBe("GET /x with [redacted]");
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "[redacted]" });
    expect(event.extra).toEqual({ detail: "[redacted]", count: 3 });
  });

  test("marks our own frames in_app and dependencies not", () => {
    const frames = [
      { filename: "src/ui/App.tsx" },
      { filename: "/Users/somebody/code/sentry-tui/src/api/client.ts" },
      { filename: "node_modules/@sentry/core/index.js" },
      { filename: "native" },
    ];
    scrubEvent({ exception: { values: [{ stacktrace: { frames } }] } });
    expect(frames.map((f) => (f as { in_app?: boolean }).in_app)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
