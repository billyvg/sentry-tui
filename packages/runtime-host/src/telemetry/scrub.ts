/**
 * Text sanitizers applied to everything on its way out.
 *
 * Pure string work, kept apart from the SDK wrapper so the rules can be
 * tested directly — these are the last line between a credential and an
 * error report, so they get to be boring and well covered.
 */

/** `sntryu_…` user tokens and `sntrys_…` org tokens, as Sentry issues them. */
const SENTRY_TOKEN = /\bsntr(?:yu|ys)_[A-Za-z0-9_-]+/g;
/** Any `Authorization: Bearer …` value that made it into a message. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
/** Credential fields echoed back inside a JSON error body. */
const JSON_SECRET = /"(access_token|refresh_token|client_secret|token|password)"\s*:\s*"[^"]*"/g;
/** A home directory, which carries the account name. */
const HOME_DIR = /\/(?:Users|home)\/[^/\s"']+/g;

const REDACTED = "[redacted]";

/**
 * Strip credentials and the user's home path out of arbitrary text.
 *
 * Not theoretical: `ApiError` embeds up to 200 characters of the response body
 * (`src/api/client.ts`), and a stack trace from a source checkout is full of
 * absolute paths.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(SENTRY_TOKEN, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JSON_SECRET, (_match, field: string) => `"${field}":"${REDACTED}"`)
    .replace(HOME_DIR, "~");
}

/** Segments whose children are identifiers, and what to call them. */
const CHILDREN_OF: Record<string, readonly string[]> = {
  organizations: ["{org}"],
  projects: ["{org}", "{project}"],
  teams: ["{org}", "{team}"],
  releases: ["{version}"],
  members: ["{member}"],
  users: ["{user}"],
};

/** Numeric ids, 32-char hex ids, and UUIDs all read as one identifier. */
const IDENTIFIER = /^(?:\d+|[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

/**
 * Collapse the variable parts of an API path into placeholders.
 *
 * `/organizations/acme/issues/4815162342/` becomes
 * `/organizations/{org}/issues/{id}/`, so a span or breadcrumb names the
 * endpoint rather than one call to it. The real path travels alongside as an
 * attribute for the cases where it matters.
 */
export function parameterizePath(path: string): string {
  const [withoutQuery = ""] = path.split("?");
  const segments = withoutQuery.split("/");

  // Queued placeholders from the segment that introduced them — `projects`
  // claims the two after it, everything else claims one.
  let pending: string[] = [];

  const parameterized = segments.map((segment) => {
    if (segment === "") return segment;

    const claimed = pending.shift();
    if (claimed !== undefined) return claimed;

    const children = CHILDREN_OF[segment];
    if (children) {
      pending = [...children];
      return segment;
    }

    pending = [];
    return IDENTIFIER.test(segment) ? "{id}" : segment;
  });

  return parameterized.join("/");
}

/** Query keys safe to keep: they describe the request, not the user. */
const SAFE_QUERY_KEYS = new Set([
  "statsPeriod",
  "sort",
  "limit",
  "per_page",
  "cursor",
  "utc",
  "dataset",
]);

/**
 * The subset of a query string worth recording.
 *
 * `query` is the user's own search text — what they typed into the issue
 * search bar — so it never leaves the machine. The shape of the request does.
 */
export function safeQuery(query: string | undefined): Record<string, string> {
  if (!query) return {};
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const kept: Record<string, string> = {};
  for (const [key, value] of params) {
    if (SAFE_QUERY_KEYS.has(key)) kept[key] = value;
  }
  return kept;
}

/**
 * Apply every sanitizer to an outgoing event, in place, and return it.
 *
 * Two jobs beyond redaction. It drops `server_name`, which the Node SDK fills
 * with the machine's hostname — unremarkable for a server, an identifying
 * detail for a desktop CLI. And it marks our own frames `in_app`: the compiled
 * binary is built with `--sourcemap`, so frames come back with paths relative
 * to the repo root, and the stack parser reads a non-absolute path as
 * third-party.
 */
export function scrubEvent<T extends TelemetryEvent>(event: T): T {
  delete event.server_name;

  if (event.message) event.message = scrubSecrets(event.message);

  const debugFiles = new Set(
    event.debug_meta?.images?.flatMap((image) => (image.code_file ? [image.code_file] : [])) ?? [],
  );

  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubSecrets(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      const belongsToDebugBundle =
        (frame.filename !== undefined && debugFiles.has(frame.filename)) ||
        (frame.abs_path !== undefined && debugFiles.has(frame.abs_path));
      if (frame.filename) frame.filename = scrubSecrets(frame.filename);
      if (frame.abs_path) frame.abs_path = scrubSecrets(frame.abs_path);
      frame.in_app = belongsToDebugBundle || isOwnFrame(frame.filename);
    }
  }

  for (const image of event.debug_meta?.images ?? []) {
    if (image.code_file) image.code_file = scrubSecrets(image.code_file);
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubSecrets(crumb.message);
    scrubValues(crumb.data);
  }

  scrubValues(event.extra);
  return event;
}

/** A frame is ours when it names a file under `src/` that isn't a dependency. */
function isOwnFrame(filename: string | undefined): boolean {
  if (!filename) return false;
  if (filename.includes("node_modules")) return false;
  return filename.startsWith("src/") || filename.includes("/src/");
}

/** Scrub the string values of a loose bag in place, leaving other types alone. */
function scrubValues(bag: Record<string, unknown> | undefined): void {
  if (!bag) return;
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value === "string") bag[key] = scrubSecrets(value);
  }
}

/**
 * The slice of Sentry's `Event` these sanitizers touch.
 *
 * Declared here rather than imported so they stay testable against plain
 * object literals, and so this module keeps no dependency on the SDK.
 */
export interface TelemetryEvent {
  server_name?: string | undefined;
  message?: string | undefined;
  debug_meta?: {
    images?: { code_file?: string | undefined }[] | undefined;
  };
  exception?: {
    values?: {
      value?: string | undefined;
      stacktrace?: {
        frames?: {
          filename?: string | undefined;
          abs_path?: string | undefined;
          in_app?: boolean | undefined;
        }[];
      };
    }[];
  };
  breadcrumbs?: { message?: string | undefined; data?: Record<string, unknown> | undefined }[];
  extra?: Record<string, unknown> | undefined;
}
