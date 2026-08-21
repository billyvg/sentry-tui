import type { AuthProvider } from "~/api/auth";

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

export class SentryClient {
  private readonly auth: AuthProvider;
  private readonly baseUrl: string;
  private readonly latencyMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Most recent rate-limit headers, for the status bar. */
  rateLimit: RateLimit = {};

  constructor(options: SentryClientOptions) {
    this.auth = options.auth;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.latencyMs = options.latencyMs ?? Number(process.env["SENTRY_TUI_LATENCY"] ?? 0);
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * A 401 from an expired OAuth token is indistinguishable from a 401 for a
   * bad one, so renew once and replay the request before surfacing it. The
   * provider says no when it has nothing to renew with (env or personal
   * tokens), and a failed renewal throws its own, more useful, error.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<Page<T>> {
    try {
      return await this.attemptWithRetries<T>(path, options);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!this.auth.refresh || !(await this.auth.refresh())) throw error;
      return await this.attemptWithRetries<T>(path, options);
    }
  }

  private async attemptWithRetries<T>(path: string, options: RequestOptions): Promise<Page<T>> {
    let lastError: ApiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attempt<T>(path, options);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.retryable) throw error;
        lastError = error;
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

  private async attempt<T>(
    path: string,
    { method = "GET", query, body, signal }: RequestOptions,
  ): Promise<Page<T>> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    const token = await this.auth.getToken();
    const url = `${this.baseUrl}${path}${buildQuery(query)}`;

    // Compose the caller's signal with our own timeout so either can abort.
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal: composed,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      // A caller-initiated abort is not a failure — let it propagate as-is.
      if (signal?.aborted) throw error;
      throw new ApiError(error instanceof Error ? error.message : "Network request failed", {
        status: 0,
        retryable: true,
      });
    }

    this.rateLimit = parseRateLimit(response.headers);

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const links = parseLinkHeader(response.headers.get("Link"));
    return {
      data: (await response.json()) as T,
      nextCursor: links.next,
      prevCursor: links.prev,
      rateLimit: this.rateLimit,
    };
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
