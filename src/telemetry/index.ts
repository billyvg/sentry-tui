/**
 * sentry-tui reporting its own errors, using the product it browses.
 *
 * The whole surface is a no-op until `initTelemetry()` decides reporting is on
 * — see `config.ts` for that decision. Two consequences worth knowing:
 *
 * - The SDK is loaded by dynamic `import()` inside `initTelemetry`, so a run
 *   with telemetry off (tests, CI, `--help`, a dev checkout) never evaluates
 *   it at all. Every other export here is synchronous and cheap.
 * - Nothing in this module may write to stdout or stderr. A TUI owns the
 *   screen, and a stray line from a failed send would corrupt it. The SDK is
 *   silent by default; keep `debug` off and it stays that way.
 *
 * Everything named here — logs, metrics, the `source` an error is reported
 * under — uses one dotted scheme, `<namespace>.<subject>.<event>`. See
 * `TelemetryName` below, and the table in `AGENTS.md`.
 */

import type { Span } from "@sentry/bun";

import { isCompiledBinary, resolveTelemetry } from "~/telemetry/config";
import { parameterizePath, safeQuery, scrubEvent } from "~/telemetry/scrub";

type SentrySdk = typeof import("@sentry/bun");

/** The loaded SDK, or null while telemetry is off. Doubles as the on switch. */
let sentry: SentrySdk | null = null;

/** How long a quit may wait for pending events before it gives up. */
const FLUSH_TIMEOUT_MS = 800;

/** And then for the envelope that closes the session. */
const SESSION_FLUSH_TIMEOUT_MS = 300;

/** A screen that never finishes loading must not hold its span open forever. */
const NAVIGATION_TIMEOUT_MS = 10_000;

/**
 * A telemetry name: `<namespace>.<subject>.<event>`, lowercase, `snake_case`
 * within a segment. Logs, metrics, and the `source` an error is filed under
 * all draw from the same namespace, so one prefix search narrows from a whole
 * subsystem (`api.`) to one thing that happens in it (`api.request.failed`)
 * without knowing in advance which of the three recorded it.
 *
 * The type only enforces the three segments — `AGENTS.md` holds the list of
 * namespaces in use and the rule for adding one. Names are dimensions, so
 * anything that varies per run (a route, a screen, an org) is an attribute,
 * never part of the name.
 *
 * Span names and ops are the exception: those follow Sentry's own semantic
 * conventions (`http.client`, `GET /organizations/{org}/issues/`) because the
 * product reads them, and are not renamed to fit this.
 */
export type TelemetryName = `${string}.${string}.${string}`;

export function isTelemetryEnabled(): boolean {
  return sentry !== null;
}

/**
 * Start reporting, if this run should. Safe to call once, early, always.
 *
 * Returns quietly when telemetry is off or already started, and swallows any
 * failure to load or initialize the SDK — reporting is never worth breaking
 * the app over.
 */
export async function initTelemetry(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (sentry) return;

  const settings = resolveTelemetry(env, { compiled: isCompiledBinary() });
  if (!settings) return;

  try {
    const sdk = await import("@sentry/bun");

    sdk.init({
      dsn: settings.dsn,
      release: settings.release,
      environment: settings.environment,
      tracesSampleRate: settings.tracesSampleRate,
      // Curated rather than default. Excluded on purpose: the uncaught
      // exception and rejection handlers (we own those — the terminal has to
      // be restored before anything prints), the http/fetch instrumentation
      // (it cannot see Bun's native fetch, so requests are traced by hand in
      // `SentryClient`), context lines (in a compiled binary the frame's
      // relative path would read whatever file happens to sit there in the
      // user's cwd), console (OpenTUI owns it), and modules (meaningless once
      // everything is bundled into one binary).
      defaultIntegrations: false,
      integrations: [
        sdk.eventFiltersIntegration(),
        sdk.functionToStringIntegration(),
        sdk.linkedErrorsIntegration(),
        sdk.dedupeIntegration(),
        sdk.nodeContextIntegration({ cloudResource: false }),
        // Release health is driven by `beginAppRun`, not by process lifetime:
        // `processSessionIntegration` would file every `sentry-tui status` as
        // a session and quietly inflate the crash-free rate.
      ],
      // Structured logs, which unlike breadcrumbs are queryable without an
      // error to hang off — the record of what the app did, not just what it
      // did before something broke.
      enableLogs: true,
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
    });

    sentry = sdk;
  } catch {
    // No DSN is a configuration choice; a broken SDK is not worth a crash.
    sentry = null;
  }
}

/**
 * Attach the signed-in account to everything reported from here on.
 *
 * The credentials file already carries the account an OAuth login resolved
 * (`src/api/config.ts`), so this costs no request. A personal-token user has
 * no such record and is identified only by the organization they opened.
 */
export function identify(who: {
  user?: { id?: string; name?: string; email?: string } | undefined;
  org?: string | undefined;
}): void {
  if (!sentry) return;
  if (who.user?.id || who.user?.email) {
    sentry.setUser({
      id: who.user.id,
      email: who.user.email,
      username: who.user.name,
    });
  }
  if (who.org) {
    // Both, because they reach different places. A tag is searchable on events
    // and nothing else; logs carry the scope's *attributes*, which tags are
    // not. Setting it here once puts it on everything that follows — no call
    // site has to remember to pass it.
    sentry.setTag("org", who.org);
    sentry.setAttributes({ org: who.org });
  }
}

export interface ReportContext {
  /** Where this came from, e.g. `"api.request.failed"` — a searchable tag. */
  source?: TelemetryName;
  /** False when nothing caught it: an uncaught throw or a rejected promise. */
  handled?: boolean;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Report something that went wrong.
 *
 * Deliberately not every failure: an expired token or a 404 is a state the UI
 * renders, not a bug to fix. Callers decide, and the choices they make are
 * documented where they make them.
 */
export function reportError(error: unknown, context: ReportContext = {}): void {
  if (!sentry) return;
  const { source, handled = true, tags, extra } = context;
  sentry.captureException(error, {
    mechanism: { type: source ?? "generic", handled },
    captureContext: {
      tags: { ...tags, ...(source ? { source } : {}) },
      extra,
    },
  });
}

export interface Crumb {
  category: "navigation" | "http" | "ui" | "auth";
  message: string;
  level?: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

/** Record a step on the way to whatever happens next. */
export function breadcrumb(crumb: Crumb): void {
  if (!sentry) return;
  sentry.addBreadcrumb({
    category: crumb.category,
    message: crumb.message,
    level: crumb.level ?? "info",
    data: crumb.data,
  });
}

/**
 * Values worth attaching to a log or a metric: small, structured, never
 * free-form user text.
 */
export type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Write a structured log.
 *
 * Distinct from a breadcrumb, which only surfaces if something later fails.
 * A log stands on its own and stays queryable, so this is where the things
 * worth knowing about a healthy session go — which screens got opened, how
 * long they took, which requests the server turned down.
 *
 * Kept deliberately sparse. A terminal session should produce tens of these,
 * not thousands, and nothing here may ever reach the actual terminal.
 *
 * The message is a `TelemetryName` rather than a sentence so that logs group
 * and filter the way metrics do. Whatever made this occurrence different from
 * the last one goes in `attributes`.
 */
export function log(
  level: "info" | "warn" | "error",
  name: TelemetryName,
  attributes?: TelemetryAttributes,
): void {
  if (!sentry) return;
  sentry.logger[level](name, attributes);
}

/**
 * Count something that happened. Not an error — a fact about usage.
 *
 * This is where the expected-but-worth-knowing outcomes go: a run that found
 * no credentials, a rate limit, anything a user can act on and nobody has to
 * fix. Filing those as errors buries the real ones; a counter still answers
 * how often they happen.
 *
 * Attributes are dimensions to break the count down by, so they must stay
 * low-cardinality — a boolean, an enum, a status code, never a slug or a path.
 */
export function countMetric(name: TelemetryName, attributes?: TelemetryAttributes): void {
  if (!sentry) return;
  sentry.metrics.count(name, 1, attributes ? { attributes } : undefined);
}

// --- Tracing -------------------------------------------------------------
//
// Bun's fetch is native, so none of the SDK's automatic HTTP instrumentation
// sees it and every span below is raised by hand. The tree is two deep: a root
// span for what the user asked for (startup, or opening a screen) and a child
// per request it set off. Requests start inside React effects, well outside
// the root's synchronous scope, so parenting goes through `withActiveSpan`
// rather than ambient async context.

let startupSpan: Span | undefined;
let navigationSpan: Span | undefined;
/** The screen `navigationSpan` belongs to, so a late close can't hit the wrong one. */
let navigationName: string | undefined;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
/** When the current screen was opened, for the duration it gets logged with. */
let navigationStartedAt = 0;
/** Request spans still open under the current screen. */
let requestsUnderNavigation = 0;
/** The screen settled while requests were still running; close when they stop. */
let closePending = false;

/** Whatever a new request span should hang off: the open screen, else startup. */
function currentParent(): Span | undefined {
  return navigationSpan ?? startupSpan;
}

/**
 * This run is someone actually using the app, not a one-shot CLI command.
 *
 * Starts the release-health session and the startup timer, both of which
 * describe a session at a terminal. `sentry-tui status` is reported on if it
 * throws, but it is not a session, and counting it as one would make the
 * crash-free rate a measure of how often people run `status`.
 */
export function beginAppRun(): void {
  if (!sentry) return;
  sentry.startSession();
  startupSpan = sentry.startInactiveSpan({ name: "startup", op: "app.start" });
}

/** Time one step of startup — resolving credentials, picking an org. */
export async function traceStartupStep<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!sentry || !startupSpan) return await run();
  return await sentry.withActiveSpan(startupSpan, () =>
    sentry!.startSpan({ name, op: "app.start.step" }, run),
  );
}

/** Startup is over once React has painted something. */
export function finishStartup(): void {
  startupSpan?.end();
  startupSpan = undefined;
}

/**
 * Open a screen. Ends the previous screen's span, whatever state it was in.
 *
 * A screen that never settles would otherwise hold its span — and every
 * request span parented to it — open for the rest of the session, so an
 * unsettled navigation is closed on a timer instead.
 */
export function beginNavigation(name: string): void {
  if (!sentry) return;
  closeNavigation();
  navigationSpan = sentry.startInactiveSpan({ name, op: "navigation" });
  navigationName = name;
  navigationStartedAt = Date.now();
  navigationTimer = setTimeout(() => {
    navigationSpan?.setStatus({ code: 2, message: "deadline_exceeded" });
    closeNavigation();
  }, NAVIGATION_TIMEOUT_MS);
  navigationTimer.unref?.();
}

/**
 * The screen settled. Close its span once its requests have finished too.
 *
 * Two subtleties, both learned from watching real traces:
 *
 * `name` is checked because the caller opens a screen during render but
 * closes the previous one from an effect cleanup, which runs *after* — so an
 * unguarded close would tear down the span that was just opened for the
 * screen being navigated to.
 *
 * A request still in flight defers the close. Ending the parent first sends
 * the transaction without that request, and the request then arrives on its
 * own as an orphan — which is how an avatar fetch ends up looking like a
 * separate page load.
 *
 * `settledAt` (epoch ms) is when the screen was ready, which is a moment
 * before the caller's debounce agreed that it was.
 */
export function endNavigation(name: string, settledAt?: number): void {
  if (navigationName !== name) return;
  if (requestsUnderNavigation > 0) {
    closePending = true;
    return;
  }
  closeNavigation(settledAt, true);
}

/** Leaving a screen. Close its span now, whatever is still in flight. */
export function abandonNavigation(name: string): void {
  if (navigationName !== name) return;
  closeNavigation();
}

/**
 * @param endAt Epoch ms the screen was ready, when that differs from now.
 * @param settled Whether it finished loading, as opposed to being left or
 *   timing out. Only a screen that settled is worth logging a duration for.
 */
function closeNavigation(endAt?: number, settled = false): void {
  if (settled && navigationName) {
    log("info", "nav.screen.opened", {
      screen: navigationName,
      duration_ms: (endAt ?? Date.now()) - navigationStartedAt,
    });
  }
  if (navigationTimer) clearTimeout(navigationTimer);
  navigationTimer = undefined;
  navigationSpan?.end(endAt);
  navigationSpan = undefined;
  navigationName = undefined;
  requestsUnderNavigation = 0;
  closePending = false;
}

export interface RequestSpec {
  method: string;
  /** The real path, e.g. `/organizations/acme/issues/`. */
  path: string;
  /** The encoded query string, filtered to `safeQuery`'s allowlist. */
  query?: string | undefined;
}

export interface RequestOutcome {
  /** The final HTTP status. 0 means the request never reached a server. */
  status: number;
  /** How many retries it took — 0 when it worked first time. */
  retries: number;
  /**
   * The caller abandoned it. Every keystroke in a search box supersedes the
   * request before it, so these are routine: the span still records the work,
   * but they leave no breadcrumb and are never reported.
   */
  cancelled?: boolean | undefined;
}

/** Ends a request span and leaves a breadcrumb. Always call it, even on failure. */
export type FinishRequest = (outcome: RequestOutcome) => void;

/**
 * Start timing one API request, parented to whatever the user is waiting on.
 *
 * Measures the whole `request()` call rather than each attempt, so a span is
 * the latency someone actually sat through, retries and all.
 */
export function beginRequest(spec: RequestSpec): FinishRequest {
  const route = `${spec.method} ${parameterizePath(spec.path)}`;
  const startedAt = Date.now();

  const parent = sentry ? currentParent() : undefined;

  // A request with nothing waiting on it is background work — an avatar, a
  // secondary nav list, a refresh of something off screen. Tracing those as
  // root spans would file one transaction per background fetch and bury the
  // thing tracing is here to show: how long opening a screen takes. They
  // still leave a breadcrumb, which is what they are worth.
  if (!sentry || !parent) {
    return (outcome) => leaveHttpCrumb(route, startedAt, outcome);
  }

  const span = sentry.withActiveSpan(parent, () =>
    sentry!.startInactiveSpan({
      name: route,
      op: "http.client",
      attributes: {
        "http.request.method": spec.method,
        "url.path": spec.path,
        ...safeQuery(spec.query),
      },
    }),
  );

  // Only requests belonging to the open screen hold it open.
  const holdsNavigation = parent === navigationSpan;
  if (holdsNavigation) requestsUnderNavigation++;

  const release = () => {
    if (!holdsNavigation) return;
    requestsUnderNavigation--;
    // The screen settled a moment ago and was only waiting on this.
    if (requestsUnderNavigation === 0 && closePending) closeNavigation(undefined, true);
  };

  return ({ status, retries, cancelled }) => {
    if (retries > 0) span.setAttribute("http.retry_count", retries);
    if (cancelled) {
      span.setStatus({ code: 2, message: "cancelled" });
      span.end();
      release();
      return;
    }

    span.setAttribute("http.response.status_code", status);
    // 0 is our own marker for "never reached the server".
    span.setStatus(status > 0 && status < 400 ? { code: 1 } : { code: 2 });
    span.end();
    // After the child has ended, never before — releasing first can close the
    // parent and leave this span outside the transaction it belongs to.
    release();

    leaveHttpCrumb(route, startedAt, { status, retries });
  };
}

/** The trail a later error gets to read: what was fetched, and how it went. */
function leaveHttpCrumb(route: string, startedAt: number, outcome: RequestOutcome): void {
  if (outcome.cancelled) return;
  breadcrumb({
    category: "http",
    message: `${route} → ${outcome.status === 0 ? "network error" : outcome.status}`,
    level: outcome.status >= 500 || outcome.status === 0 ? "error" : "info",
    data: {
      duration_ms: Date.now() - startedAt,
      ...(outcome.retries > 0 ? { retries: outcome.retries } : {}),
    },
  });
}

// --- Lifecycle -----------------------------------------------------------

/**
 * Restores the terminal before a crash report is written. Set by `runApp`
 * once a renderer exists; until then a crash has nothing to undo.
 */
let restoreTerminal: (() => void) | null = null;

export function setTerminalRestore(restore: () => void): void {
  restoreTerminal = restore;
}

/**
 * Catch what nothing else did.
 *
 * Worth installing even with telemetry off: without this an uncaught throw
 * kills the process with the terminal still in raw mode, and the user has to
 * type `reset` blind. Order matters — restore the terminal, report, then
 * print somewhere the user can actually read it.
 */
export function installCrashHandlers(): void {
  const fatal = (error: unknown, event: "uncaughtException" | "unhandledRejection") => {
    restoreTerminal?.();
    restoreTerminal = null;
    // The process event name is what the user sees; the telemetry name is what
    // the two crash sources are told apart by in Sentry.
    const source =
      event === "uncaughtException"
        ? "app.crash.uncaught_exception"
        : "app.crash.unhandled_rejection";
    log("error", "app.session.crashed", {
      source,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    reportError(error, { source, handled: false });
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    void shutdownTelemetry().finally(() => {
      process.stderr.write(`\nsentry-tui crashed (${event}):\n${message}\n`);
      process.exit(1);
    });
  };

  process.on("uncaughtException", (error) => fatal(error, "uncaughtException"));
  process.on("unhandledRejection", (reason) => fatal(reason, "unhandledRejection"));
}

/**
 * Close the session and get everything on the wire before the process goes.
 *
 * The two flushes are not redundant, and their order is the whole point.
 * `captureException` returns before the event is processed, and it is that
 * processing which marks the session as having errored. End the session first
 * and the run is filed as clean no matter what went wrong in it — so: settle
 * the events, *then* close the session, then send it.
 *
 * Both are capped, because a quit that hangs on a dead network is worse than a
 * lost event, and neither may be given a timeout of zero — the SDK reads that
 * as "wait indefinitely".
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sentry) return;
  try {
    closeNavigation();
    finishStartup();
    await sentry.flush(FLUSH_TIMEOUT_MS);
    sentry.endSession();
    await sentry.flush(SESSION_FLUSH_TIMEOUT_MS);
  } catch {
    // Nothing useful to do, and nowhere safe to say it.
  }
}
