import { describe, expect, mock, test } from "bun:test";

import { createTokenAuthProvider, MissingTokenError } from "~/api/auth";
import { ApiError, parseLinkHeader, SentryClient } from "~/api/client";
import { queryDiscover, queryDiscoverTimeseries, queryExploreTimeseries } from "~/api/discover";
import { fetchIssueStats, listIssues, updateIssue } from "~/api/issues";
import { listReplays } from "~/api/replays";
import { listTraceItemAttributes } from "~/api/traceItemAttributes";
import {
  installTelemetryService,
  type TelemetryService,
} from "@sentry-tui/runtime-contract/telemetry";
import { groupsFixture } from "./fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const inertTelemetry: TelemetryService = {
  isTelemetryEnabled: () => false,
  identify: () => {},
  reportError: () => {},
  breadcrumb: () => {},
  log: () => {},
  countMetric: () => {},
  beginNavigation: () => {},
  endNavigation: () => {},
  abandonNavigation: () => {},
  beginRequest: () => () => {},
};

/** Install a recorder for one test and return the calls plus its cleanup. */
function recordTelemetry() {
  const reportError = mock<TelemetryService["reportError"]>(() => {});
  const countMetric = mock<TelemetryService["countMetric"]>(() => {});
  installTelemetryService({ ...inertTelemetry, reportError, countMetric });
  return {
    reportError,
    countMetric,
    restore: () => installTelemetryService(inertTelemetry),
  };
}

describe("parseLinkHeader", () => {
  test("returns the next cursor only when the page has results", () => {
    const header =
      '<https://sentry.io/api/0/x/?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", ' +
      '<https://sentry.io/api/0/x/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"';

    expect(parseLinkHeader(header)).toEqual({
      next: "0:100:0",
      prev: null, // results="false" means there is no previous page to fetch
    });
  });

  test("treats an exhausted next link as the end of pagination", () => {
    const header =
      '<https://sentry.io/api/0/x/?cursor=0:200:0>; rel="next"; results="false"; cursor="0:200:0"';
    expect(parseLinkHeader(header).next).toBeNull();
  });

  test("tolerates a missing header", () => {
    expect(parseLinkHeader(null)).toEqual({ next: null, prev: null });
  });
});

describe("auth", () => {
  test("prefers SENTRY_AUTH_TOKEN over the stored config", async () => {
    process.env["SENTRY_AUTH_TOKEN"] = "sntryu_from_env";
    try {
      const provider = createTokenAuthProvider({ token: "sntryu_from_file" });
      expect(await provider.getToken()).toBe("sntryu_from_env");
      expect(provider.describe()).toBe("$SENTRY_AUTH_TOKEN");
    } finally {
      delete process.env["SENTRY_AUTH_TOKEN"];
    }
  });

  test("ignores blank env values and falls back to the config file", async () => {
    process.env["SENTRY_AUTH_TOKEN"] = "   ";
    try {
      const provider = createTokenAuthProvider({ token: "sntryu_from_file" });
      expect(await provider.getToken()).toBe("sntryu_from_file");
    } finally {
      delete process.env["SENTRY_AUTH_TOKEN"];
    }
  });

  test("explains how to get a token when none is configured", async () => {
    const provider = createTokenAuthProvider({});
    expect(provider.getToken()).rejects.toThrow(MissingTokenError);
  });
});

describe("SentryClient", () => {
  test("sends a bearer token and parses pagination", async () => {
    const { impl, calls } = stubFetch(() =>
      json(groupsFixture, {
        headers: {
          Link: '<https://x/?cursor=0:25:0>; rel="next"; results="true"; cursor="0:25:0"',
          "X-Hits": "73",
          "X-Sentry-Rate-Limit-Remaining": "37",
        },
      }),
    );
    const client = new SentryClient({ auth, fetchImpl: impl });

    const page = await listIssues(client, { org: "acme" });

    expect(page.data).toHaveLength(3);
    expect(page.nextCursor).toBe("0:25:0");
    expect(page.totalCount).toBe(73);
    expect(page.rateLimit.remaining).toBe(37);

    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer sntryu_test");
  });

  test("omits a total count when the endpoint sends no X-Hits header", async () => {
    const { impl } = stubFetch(() => json(groupsFixture));
    const client = new SentryClient({ auth, fetchImpl: impl });

    const page = await listIssues(client, { org: "acme" });

    expect(page.totalCount).toBeUndefined();
  });

  test("omits stats from the list request so the first paint is fast", async () => {
    const { impl, calls } = stubFetch(() => json([]));
    const client = new SentryClient({ auth, fetchImpl: impl });

    await listIssues(client, { org: "acme" });

    const url = calls[0]!.url;
    expect(url).toContain("collapse=stats");
    expect(url).toContain("collapse=unhandled");
    expect(url).toContain("limit=25");
    expect(url).toContain("shortIdLookup=1");
    expect(new URL(url).searchParams.getAll("project")).toEqual(["-1"]);
  });

  test("keys the /issues-stats/ array response by issue id", async () => {
    // The endpoint returns an array whose entries carry their own `id`, not an
    // object keyed by id. Getting this wrong silently yields no stats at all.
    const { impl, calls } = stubFetch(() =>
      json([
        { id: "1", count: "42", userCount: 7, stats: { "24h": [[0, 1]] } },
        { id: "2", count: "9", userCount: 1 },
      ]),
    );
    const client = new SentryClient({ auth, fetchImpl: impl });

    const stats = await fetchIssueStats(client, { org: "acme", groups: ["1", "2"] });

    expect(Object.keys(stats).sort()).toEqual(["1", "2"]);
    expect(stats["1"]?.count).toBe("42");
    expect(stats["1"]?.stats?.["24h"]).toEqual([[0, 1]]);
    expect(new URL(calls[0]!.url).searchParams.getAll("project")).toEqual(["-1"]);
  });

  test("skips the stats request entirely when there are no ids", async () => {
    const { impl, calls } = stubFetch(() => json([]));
    const client = new SentryClient({ auth, fetchImpl: impl });

    expect(await fetchIssueStats(client, { org: "acme", groups: [] })).toEqual({});
    expect(calls).toHaveLength(0);
  });

  test("repeats array params rather than joining them", async () => {
    const { impl, calls } = stubFetch(() => json([]));
    const client = new SentryClient({ auth, fetchImpl: impl });

    await listIssues(client, { org: "acme", project: ["1", "2"] });

    expect(calls[0]!.url).toContain("project=1&project=2");
  });

  test("runs generated Discover requests through auth and pagination", async () => {
    const { impl, calls } = stubFetch(() =>
      json(
        { data: [{ id: "event-1", message: "hello" }], meta: {} },
        {
          headers: {
            "Content-Type": "application/json",
            Link: '<https://x/?cursor=0:50:0>; rel="next"; results="true"; cursor="0:50:0"',
            "X-Sentry-Rate-Limit-Remaining": "12",
          },
        },
      ),
    );
    const client = new SentryClient({ auth, fetchImpl: impl });

    const page = await queryDiscover(client, {
      org: "acme",
      dataset: "logs",
      fields: ["id", "message"],
      project: ["1", "2"],
      limit: 50,
      referrer: "sentry-tui.logs",
    });

    expect(page.rows).toEqual([{ id: "event-1", message: "hello" }]);
    expect(page.nextCursor).toBe("0:50:0");
    expect(client.rateLimit.remaining).toBe(12);
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer sntryu_test");

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/0/organizations/acme/events/");
    expect(url.searchParams.getAll("field")).toEqual(["id", "message"]);
    expect(url.searchParams.getAll("project")).toEqual(["1", "2"]);
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("referrer")).toBe("sentry-tui.logs");
  });

  test("serializes repeated filters through the completed generated operations", async () => {
    const { impl, calls } = stubFetch((url) => json(url.includes("/replays/") ? { data: [] } : []));
    const client = new SentryClient({ auth, fetchImpl: impl });

    await listReplays(client, {
      org: "acme",
      project: ["1", "2"],
      environment: ["production", "staging"],
    });
    await listTraceItemAttributes(client, {
      org: "acme",
      itemType: "spans",
      attributeType: "number",
      project: ["1", "2"],
      environment: ["production", "staging"],
    });

    const replayUrl = new URL(calls[0]!.url);
    expect(replayUrl.searchParams.getAll("project")).toEqual(["1", "2"]);
    expect(replayUrl.searchParams.getAll("environment")).toEqual(["production", "staging"]);
    expect(replayUrl.searchParams.get("queryReferrer")).toBe("replayList");

    const attributesUrl = new URL(calls[1]!.url);
    expect(attributesUrl.searchParams.getAll("project")).toEqual(["1", "2"]);
    expect(attributesUrl.searchParams.getAll("environment")).toEqual(["production", "staging"]);
    expect(attributesUrl.searchParams.getAll("attributeType")).toEqual(["number"]);
  });

  test("PUT sends a JSON body", async () => {
    const { impl, calls } = stubFetch(() => json(groupsFixture[0]));
    const client = new SentryClient({ auth, fetchImpl: impl });

    await updateIssue(client, {
      org: "acme",
      issueId: "1",
      update: { status: "resolved" },
    });

    const init = calls[0]!.init;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ status: "resolved" });
  });

  test("surfaces 401 as an actionable, non-retryable error", async () => {
    const { impl, calls } = stubFetch(() => new Response("", { status: 401 }));
    const client = new SentryClient({ auth, fetchImpl: impl });

    const error = (await listIssues(client, { org: "acme" }).catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("invalid or expired");
    expect(calls).toHaveLength(1); // not retried
  });

  test("counts a handled API rejection without filing it as an error", async () => {
    const telemetry = recordTelemetry();
    const { impl } = stubFetch(() => new Response("forbidden", { status: 403 }));
    const client = new SentryClient({ auth, fetchImpl: impl });

    try {
      await expect(listIssues(client, { org: "acme" })).rejects.toBeInstanceOf(ApiError);

      expect(telemetry.countMetric).toHaveBeenCalledWith("api.request.rejected", {
        method: "GET",
        status: 403,
      });
      expect(telemetry.reportError).not.toHaveBeenCalled();
    } finally {
      telemetry.restore();
    }
  });

  test("reports an unexpected client failure before the UI can handle it", async () => {
    const telemetry = recordTelemetry();
    const failure = new Error("credential provider exploded");
    const client = new SentryClient({
      auth: {
        getToken: async () => {
          throw failure;
        },
        describe: () => "test provider",
      },
    });

    try {
      await expect(client.request("/organizations/acme/issues/")).rejects.toBe(failure);

      expect(telemetry.reportError).toHaveBeenCalledWith(failure, {
        source: "api.request.failed",
        tags: { "http.kind": "client" },
        extra: {
          method: "GET",
          path: "/organizations/acme/issues/",
          retries: 0,
        },
      });
      expect(telemetry.countMetric).not.toHaveBeenCalled();
    } finally {
      telemetry.restore();
    }
  });

  test("retries 5xx and succeeds on a later attempt", async () => {
    let attempts = 0;
    const { impl } = stubFetch(() => {
      attempts++;
      return attempts < 3 ? new Response("boom", { status: 503 }) : json(groupsFixture);
    });
    // A real backoff would sleep 1s then 2s; the schedule is not what this
    // asserts, only that a 5xx is retried until it succeeds.
    const client = new SentryClient({ auth, fetchImpl: impl, retryBaseMs: 1 });

    const page = await listIssues(client, { org: "acme" });

    expect(attempts).toBe(3);
    expect(page.data).toHaveLength(3);
  });

  test("marks 429 retryable and derives the wait from the reset header", async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 8;
    const { impl } = stubFetch(
      () =>
        new Response("", {
          status: 429,
          headers: { "X-Sentry-Rate-Limit-Reset": String(resetAt) },
        }),
    );
    // No retries here: we want to inspect the error, not wait out the backoff.
    const client = new SentryClient({ auth, fetchImpl: impl, maxRetries: 0 });
    const error = (await client
      .request("/organizations/acme/issues/")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(8);
  });

  test("propagates caller aborts without retrying", async () => {
    const controller = new AbortController();
    const { impl, calls } = stubFetch(() => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const client = new SentryClient({ auth, fetchImpl: impl });

    expect(listIssues(client, { org: "acme", signal: controller.signal })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  test("latency injection delays the response", async () => {
    const { impl } = stubFetch(() => json([]));
    const client = new SentryClient({ auth, fetchImpl: impl, latencyMs: 120 });

    const started = performance.now();
    await listIssues(client, { org: "acme" });

    expect(performance.now() - started).toBeGreaterThanOrEqual(100);
  });
});

describe("queryDiscoverTimeseries", () => {
  /** The `events-stats/` URL a single call produced, as URLSearchParams. */
  async function paramsFor(statsPeriod: string | undefined, interval?: string) {
    const { impl, calls } = stubFetch(() => json({ data: [] }));
    const client = new SentryClient({ auth, fetchImpl: impl });
    await queryDiscoverTimeseries(client, { org: "acme", dataset: "logs", statsPeriod, interval });
    return new URL(calls[0]!.url).searchParams;
  }

  test("asks for the finest bucket the window allows, as Explore does", async () => {
    // Without this the endpoint picks its own coarse default — 15m for an
    // hour — and the chart has four bars in it.
    expect((await paramsFor("1h")).get("interval")).toBe("1m");
    expect((await paramsFor("24h")).get("interval")).toBe("5m");
    expect((await paramsFor("14d")).get("interval")).toBe("1h");
    expect((await paramsFor("90d")).get("interval")).toBe("3h");
  });

  test("lets a caller name its own interval", async () => {
    expect((await paramsFor("24h", "1h")).get("interval")).toBe("1h");
  });

  test("scopes an unfiltered Discover query to every accessible project", async () => {
    expect((await paramsFor("24h")).getAll("project")).toEqual(["-1"]);
  });

  test("omits the param when the period isn't one it can read", async () => {
    expect((await paramsFor(undefined)).has("interval")).toBe(false);
  });
});

describe("queryExploreTimeseries", () => {
  test("uses Explore's canonical endpoint and requests the partial bucket", async () => {
    const { impl, calls } = stubFetch(() => json({ timeSeries: [] }));
    const client = new SentryClient({ auth, fetchImpl: impl });
    await queryExploreTimeseries(client, {
      org: "acme",
      dataset: "spans",
      yAxis: "count(span.duration)",
      statsPeriod: "24h",
      groupBy: ["span.op", "transaction"],
      sort: "-count(span.duration)",
      topEvents: 9,
    });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toEndWith("/events-timeseries/");
    expect(url.searchParams.get("partial")).toBe("1");
    expect(url.searchParams.get("excludeOther")).toBe("0");
    expect(url.searchParams.get("sampling")).toBe("NORMAL");
    expect(url.searchParams.getAll("groupBy")).toEqual(["span.op", "transaction"]);
    expect(url.searchParams.get("sort")).toBe("-count(span.duration)");
    expect(url.searchParams.get("topEvents")).toBe("9");
  });

  test("normalizes millisecond timestamps and provisional values for BarChart", async () => {
    const response = {
      timeSeries: [
        {
          yAxis: "count()",
          values: [
            { timestamp: 1_700_000_000_000, value: 42 },
            { timestamp: 1_700_000_300_000, value: 7, incomplete: true },
          ],
        },
        {
          yAxis: "count()",
          values: [
            { timestamp: 1_700_000_000_000, value: 8 },
            { timestamp: 1_700_000_300_000, value: 3 },
          ],
        },
      ],
    };
    const { impl } = stubFetch(() => json(response));
    const client = new SentryClient({ auth, fetchImpl: impl });

    expect(await queryExploreTimeseries(client, { org: "acme", dataset: "logs" })).toEqual([
      [1_700_000_000, [{ count: 50 }], { incomplete: undefined }],
      [1_700_000_300, [{ count: 10 }], { incomplete: true }],
    ]);
  });
});
