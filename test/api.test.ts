import { describe, expect, test } from "bun:test";

import { createTokenAuthProvider, MissingTokenError } from "~/api/auth";
import { ApiError, parseLinkHeader, SentryClient } from "~/api/client";
import { fetchIssueStats, listIssues, updateIssue } from "~/api/issues";
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
          "X-Sentry-Rate-Limit-Remaining": "37",
        },
      }),
    );
    const client = new SentryClient({ auth, fetchImpl: impl });

    const page = await listIssues(client, { org: "acme" });

    expect(page.data).toHaveLength(3);
    expect(page.nextCursor).toBe("0:25:0");
    expect(page.rateLimit.remaining).toBe(37);

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sntryu_test");
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
  });

  test("keys the /issues-stats/ array response by issue id", async () => {
    // The endpoint returns an array whose entries carry their own `id`, not an
    // object keyed by id. Getting this wrong silently yields no stats at all.
    const { impl } = stubFetch(() =>
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

  test("retries 5xx and succeeds on a later attempt", async () => {
    let attempts = 0;
    const { impl } = stubFetch(() => {
      attempts++;
      return attempts < 3 ? new Response("boom", { status: 503 }) : json(groupsFixture);
    });
    const client = new SentryClient({ auth, fetchImpl: impl });

    const page = await listIssues(client, { org: "acme" });

    expect(attempts).toBe(3);
    expect(page.data).toHaveLength(3);
  }, 15_000);

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
