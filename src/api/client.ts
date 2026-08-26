import type { AuthProvider } from "~/api/auth";
import { beginRequest, log, reportError } from "~/telemetry/index";

export const DEFAULT_BASE_URL = "https://sentry.io/api/0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
/** First backoff step; each further attempt doubles it. */
const DEFAULT_RETRY_BASE_MS = 1000;

export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  /** Seconds until the rate limit window resets, when the server told us. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    {
      status,
      retryable,
      retryAfterSeconds,
    }: { status: number; retryable: boolean; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimit {
  limit?: number;
  remaining?: number;
  /** UTC seconds from epoch. */
  reset?: number;
  concurrentLimit?: number;
  concurrentRemaining?: number;
}

export interface Page<T> {
  data: T;
  /** Cursor for the next page, or null when `results="false"`. */
  nextCursor: string | null;
  prevCursor: string | null;
  rateLimit: RateLimit;
}

export interface RequestOptions {
  method?: "GET" | "PUT" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Parse a Sentry `Link` header.
 *
 * Cursors come back for *both* directions even when a page is empty, so
 * `results="false"` — not a missing link — is the stop condition.
 *
 * `<https://…?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"`
 */
export function parseLinkHeader(header: string | null): {
  next: string | null;
  prev: string | null;
} {
  const result: { next: string | null; prev: string | null } = {
    next: null,
    prev: null,
  };
  if (!header) return result;

  for (const section of header.split(",")) {
    const rel = /rel="([^"]+)"/.exec(section)?.[1];
    const results = /results="([^"]+)"/.exec(section)?.[1];
    const cursor = /cursor="([^"]+)"/.exec(section)?.[1];
    if (!rel || !cursor) continue;
    // An empty page still carries a cursor; only follow it if there's data.
    if (results !== "true") continue;
    if (rel === "next") result.next = cursor;
    if (rel === "previous") result.prev = cursor;
  }
  return result;
}

function parseRateLimit(headers: Headers): RateLimit {
  const num = (name: string) => {
    const raw = headers.get(name);
    if (raw === null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    limit: num("X-Sentry-Rate-Limit-Limit"),
    remaining: num("X-Sentry-Rate-Limit-Remaining"),
    reset: num("X-Sentry-Rate-Limit-Reset"),
    concurrentLimit: num("X-Sentry-Rate-Limit-ConcurrentLimit"),
    concurrentRemaining: num("X-Sentry-Rate-Limit-ConcurrentRemaining"),
  };
}

function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    // Sentry takes repeated keys for arrays (?project=1&project=2).
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SentryClientOptions {
  auth: AuthProvider;
  baseUrl?: string;
  /** Artificial delay per request, for exercising loading states. */
  latencyMs?: number;
  /** Retry attempts for transient failures. Set to 0 to fail fast. */
  maxRetries?: number;
  /**
   * Base for the exponential backoff between retries, in milliseconds.
   *
   * Tests set this low: the real 1s/2s waits are the behaviour under test only
   * in the sense that we back off at all, and sleeping through them cost more
   * than the rest of the API suite combined.
   */
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * What one `request()` call turned out to cost, filled in as it goes.
 *
 * Retries and a token refresh happen below the call the caller made, so the
 * count and the final status have to be carried back up somehow; a mutable
 * bag threaded down is the smallest way to do it without changing what the
 * inner methods return.
 */
interface Tally {
  retries: number;
  /** The last HTTP status seen. 0 means the request never reached a server. */
  status: number;
}

/** One request after its URL and body have been serialized. */
interface TransportRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: BodyInit;
  signal?: AbortSignal;
  /** Stable API route used by request telemetry. */
  path: string;
  query: string;
}

/** Per-call options shared by every generated `@sentry/api` operation. */
export interface GeneratedRequestOptions {
  baseUrl: string;
  fetch: typeof fetch;
  parseAs: "json";
  signal?: AbortSignal;
  throwOnError: true;
}

export class SentryClient {
  private readonly auth: AuthProvider;
  private readonly baseUrl: string;
  private readonly siteUrl: string;
  private readonly latencyMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Most recent rate-limit headers, for the status bar. */
  rateLimit: RateLimit = {};

  constructor(options: SentryClientOptions) {
    this.auth = options.auth;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    // Generated routes already start with `/api/0`, while the legacy client
    // takes paths relative to it. Keep both rooted at the caller's host.
    this.siteUrl = this.baseUrl.replace(/\/api\/0\/?$/, "");
    this.latencyMs = options.latencyMs ?? Number(process.env["SENTRY_TUI_LATENCY"] ?? 0);
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Build the common options for an `@sentry/api` operation.
   *
   * Its generated route and query serializer stay in charge, while the custom
   * fetch funnels the resulting Request through this client's auth refresh,
   * retries, timeout, rate-limit tracking, and telemetry.
   */
  generatedOptions(signal?: AbortSignal): GeneratedRequestOptions {
    return {
      baseUrl: this.siteUrl,
      fetch: this.generatedFetch,
      parseAs: "json",
      signal,
      throwOnError: true,
    };
  }

  /**
   * A 401 from an expired OAuth token is indistinguishable from a 401 for a
   * bad one, so renew once and replay the request before surfacing it. The
   * provider says no when it has nothing to renew with (env or personal
   * tokens), and a failed renewal throws its own, more useful, error.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<Page<T>> {
    const method = options.method ?? "GET";
    const query = buildQuery(options.query);
    const hasBody = options.body !== undefined;
    const response = await this.send({
      url: `${this.baseUrl}${path}${query}`,
      method,
      headers: new Headers({
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      }),
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal,
      path,
      query,
    });
    const links = parseLinkHeader(response.headers.get("Link"));
    return {
      data: (await response.json()) as T,
      nextCursor: links.next,
      prevCursor: links.prev,
      rateLimit: this.rateLimit,
    };
  }

  /** Route a Request produced by `@sentry/api` through the shared transport. */
  private readonly generatedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body === null ? undefined : await request.arrayBuffer();
    return this.send({
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      ...(body === undefined ? {} : { body }),
      signal: request.signal,
      path: apiPath(url.pathname),
      query: url.search,
    });
  }) as typeof fetch;

  /** Execute one logical request, including every retry and token refresh. */
  private async send(request: TransportRequest): Promise<Response> {
    // One span per call rather than per attempt, so it measures the latency
    // someone actually sat through — retries and token refresh included.
    const finish = beginRequest({
      method: request.method,
      path: request.path,
      query: request.query,
    });
    const tally: Tally = { retries: 0, status: 0 };

    try {
      const response = await this.withRefresh(request, tally);
      finish({ status: tally.status, retries: tally.retries });
      return response;
    } catch (error) {
      const cancelled = request.signal?.aborted === true;
      const status = error instanceof ApiError ? error.status : tally.status;
      finish({ status, retries: tally.retries, cancelled });
      if (!cancelled) {
        this.report(error, {
          method: request.method,
          path: request.path,
          retries: tally.retries,
        });
      }
      throw error;
    }
  }

  /**
   * Say something about a request that failed, at the volume it deserves.
   *
   * Most of what fails here is not a bug: an expired token, a slug that no
   * longer exists, a rate limit. Those are states the UI draws and the user
   * can act on, so they are logged and left at that — an issue for every
   * stale token would drown the real ones. A 5xx or a request that never
   * reached a server is a different thing, and gets reported.
   */
  private report(error: unknown, context: { method: string; path: string; retries: number }): void {
    if (!(error instanceof ApiError)) return;

    const { status } = error;
    const route = `${context.method} ${context.path}`;
    const attributes = { route, status, retries: context.retries };

    if (status === 0 || status >= 500) {
      log("error", "api.request.failed", attributes);
      reportError(error, {
        source: "api.request.failed",
        tags: {
          "http.status": String(status),
          "http.kind": status === 0 ? "network" : "server",
        },
        extra: context,
      });
      return;
    }

    // Worth knowing about in aggregate — how often people hit the rate limit,
    // how often tokens go stale — without being anybody's bug to fix.
    if (status === 429) {
      log("warn", "api.request.rate_limited", {
        ...attributes,
        retry_after_s: error.retryAfterSeconds,
      });
    } else if (status === 401 || status === 403) {
      log("warn", "api.request.unauthorized", attributes);
    }
  }

  private async withRefresh(request: TransportRequest, tally: Tally): Promise<Response> {
    try {
      return await this.attemptWithRetries(request, tally);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!this.auth.refresh || !(await this.auth.refresh())) throw error;
      return await this.attemptWithRetries(request, tally);
    }
  }

  private async attemptWithRetries(request: TransportRequest, tally: Tally): Promise<Response> {
    let lastError: ApiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attempt(request, tally);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.retryable) throw error;
        lastError = error;
        tally.retries++;
        if (attempt === this.maxRetries) break;
        // Never blind-retry a 429; honor the server's reset window.
        const backoff =
          error.retryAfterSeconds !== undefined
            ? error.retryAfterSeconds * 1000
            : 2 ** attempt * this.retryBaseMs;
        await sleep(backoff);
      }
    }
    throw lastError;
  }

  private async attempt(request: TransportRequest, tally: Tally): Promise<Response> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    const token = await this.auth.getToken();
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    // Compose the caller's signal with our own timeout so either can abort.
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const composed = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        signal: composed,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
    } catch (error) {
      // A caller-initiated abort is not a failure — let it propagate as-is.
      if (request.signal?.aborted) throw error;
      throw new ApiError(error instanceof Error ? error.message : "Network request failed", {
        status: 0,
        retryable: true,
      });
    }

    tally.status = response.status;
    this.rateLimit = parseRateLimit(response.headers);

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return response;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    const detail = await response.text().catch(() => "");
    const message = summarize(response.status, detail, this.auth.describe());

    if (response.status === 429) {
      const reset = this.rateLimit.reset;
      const seconds = reset ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : undefined;
      return new ApiError(message, {
        status: 429,
        retryable: true,
        retryAfterSeconds: seconds,
      });
    }

    return new ApiError(message, {
      status: response.status,
      retryable: response.status >= 500,
    });
  }
}

/** Strip the generated API prefix so telemetry matches legacy route names. */
function apiPath(pathname: string): string {
  const marker = "/api/0";
  const index = pathname.indexOf(`${marker}/`);
  return index === -1 ? pathname : pathname.slice(index + marker.length);
}

function summarize(status: number, detail: string, tokenSource: string): string {
  if (status === 401) {
    return `Unauthorized — the token from ${tokenSource} is invalid or expired.`;
  }
  if (status === 403) {
    return "Forbidden — the token is missing a required scope.";
  }
  if (status === 404) {
    return "Not found — check the organization or project slug.";
  }
  const trimmed = detail.trim().slice(0, 200);
  return trimmed ? `HTTP ${status}: ${trimmed}` : `HTTP ${status}`;
}
