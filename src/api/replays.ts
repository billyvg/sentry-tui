/**
 * Session Replay — the org's replay index, and the errors behind one replay.
 *
 * Replays are the one Explore screen that is *not* a Discover dataset: they
 * come from `GET /organizations/{org}/replays/`
 * (`utils/replays/fetchReplayList.tsx:44`), which answers `{data: [...]}` with
 * one nested object per replay rather than the flat rows `events/` returns.
 *
 * The error list behind a replay *is* Discover, filtered to the replay's id —
 * `utils/replays/hooks/useReplayData.tsx:211-239` does the same query.
 *
 * Read-only throughout. The web can delete replays from this index; nothing
 * here can.
 */

import { DEFAULT_BASE_URL, type SentryClient } from "~/api/client";
import { queryDiscover, rowString, type DiscoverRow } from "~/api/discover";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A named, versioned thing the replay was recorded on: an OS, browser or SDK. */
export interface ReplayAgent {
  name?: string;
  version?: string;
}

/** Who the replay is attributed to. Every field is optional and often absent. */
export interface ReplayUser {
  /** What the web shows as the session's title, falling back to "Anonymous User". */
  displayName?: string;
  email?: string;
  id?: string;
  ip?: string;
  username?: string;
}

/**
 * One row of the replay index.
 *
 * Field names are the API's, camel-cased. `is_archived` rows are replays whose
 * recording has been deleted from blob storage while the record itself
 * remains: almost every other field comes back null, so they are rendered as a
 * tombstone rather than a session.
 */
export interface Replay {
  id: string;
  /** Numeric project id. The endpoint never returns the slug. */
  projectId?: string;
  /** The recording was deleted; only the record survives. */
  isArchived: boolean;
  /** The signed-in user has already watched this replay. */
  hasViewed: boolean;
  user: ReplayUser;
  /** ISO-8601 timestamp of the earliest event the SDK reported. */
  startedAt: string;
  /** ISO-8601 timestamp of the latest event the SDK reported. */
  finishedAt: string;
  /** `finished_at - started_at`, in **seconds** — the API's own unit. */
  durationSec?: number;
  os: ReplayAgent;
  browser: ReplayAgent;
  device: ReplayAgent & { brand?: string; family?: string };
  sdk: ReplayAgent;
  platform?: string;
  environment?: string;
  releases: string[];
  /**
   * How much happened in the session, 0-10. Derived server-side from error
   * count, duration and UI events — the web draws it as a ten-segment bar.
   *
   * Every count below, and this, is absent on an archived replay: the counts
   * lived with the recording. Absent is not zero, and must not render as it.
   */
  activity?: number;
  countErrors?: number;
  countDeadClicks?: number;
  countRageClicks?: number;
  countUrls?: number;
  countSegments?: number;
  errorIds: string[];
  traceIds: string[];
  urls: string[];
}

/** An error event that happened during a replay. */
export interface ReplayError {
  id: string;
  title: string;
  /** Short id of the issue the event rolled up into, e.g. `JAVASCRIPT-2A`. */
  issue?: string;
  level?: string;
  projectName?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPLAY_PAGE_SIZE = 50;

/**
 * Sentry's standard page-filter window, and what the web's replay index opens
 * on. Long enough that a quiet project still has rows, short enough that the
 * first page is one query.
 */
export const DEFAULT_REPLAY_PERIOD = "14d";

export const REPLAY_SORT_OPTIONS = [
  { value: "-started_at", label: "Newest" },
  { value: "started_at", label: "Oldest" },
  { value: "-activity", label: "Activity (high-low)" },
  { value: "activity", label: "Activity (low-high)" },
  { value: "-duration", label: "Longest duration" },
  { value: "duration", label: "Shortest duration" },
  { value: "-count_errors", label: "Most errors" },
  { value: "count_errors", label: "Fewest errors" },
  { value: "-count_dead_clicks", label: "Most dead clicks" },
  { value: "count_dead_clicks", label: "Fewest dead clicks" },
  { value: "-count_rage_clicks", label: "Most rage clicks" },
  { value: "count_rage_clicks", label: "Fewest rage clicks" },
  { value: "browser.name", label: "Browser (A-Z)" },
  { value: "-browser.name", label: "Browser (Z-A)" },
  { value: "os.name", label: "OS (A-Z)" },
  { value: "-os.name", label: "OS (Z-A)" },
] as const;

export type ReplaySort = (typeof REPLAY_SORT_OPTIONS)[number]["value"];
export const DEFAULT_REPLAY_SORT: ReplaySort = "-started_at";

/** Resolve persisted state to one of the replay table's sortable columns. */
export function replaySort(value: string): ReplaySort {
  return REPLAY_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ReplaySort)
    : DEFAULT_REPLAY_SORT;
}

/**
 * Columns requested from the replay index.
 *
 * `views/explore/replays/types.tsx:REPLAY_LIST_FIELDS`, with the compound
 * names collapsed to their root: the backend cannot be asked for `os.name`,
 * only `os`, which it answers with the whole nested object. The web does the
 * same collapse in `replayListApiOptions.tsx:43-44`.
 */
const REPLAY_FIELDS = [
  "activity",
  "browser",
  "count_dead_clicks",
  "count_errors",
  "count_infos",
  "count_rage_clicks",
  "count_segments",
  "count_urls",
  "count_warnings",
  "device",
  "dist",
  "duration",
  "environment",
  "error_ids",
  "finished_at",
  "has_viewed",
  "id",
  "info_ids",
  "is_archived",
  "os",
  "platform",
  "project_id",
  "releases",
  "sdk",
  "started_at",
  "tags",
  "trace_ids",
  "urls",
  "user",
  "warning_ids",
] as const;

/** `useReplayData.tsx:91-100`, minus the ms timestamp a HH:MM:SS column can't use. */
const REPLAY_ERROR_FIELDS = ["id", "title", "issue", "level", "project.name", "timestamp"] as const;

/**
 * Sentry's "all projects" sentinel.
 *
 * An error raised during a replay can belong to a different project than the
 * replay itself, so the error query deliberately ignores the project filter —
 * `useReplayData.tsx:232` passes the same sentinel for the same reason.
 */
const ALL_ACCESS_PROJECTS = ["-1"];

/** The web app behind the API, for links a terminal can't follow itself. */
const WEB_BASE_URL = DEFAULT_BASE_URL.replace(/\/api\/0\/?$/, "");

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface ListReplaysParams {
  org: string;
  query?: string;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  sort?: ReplaySort;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Envelope the replay index returns. */
interface ReplayIndexResponse {
  data: unknown[];
}

/**
 * Fetch a page of the org's replays, newest first.
 *
 * @returns The replays, plus the cursor for the next page.
 */
export async function listReplays(
  client: SentryClient,
  {
    org,
    query = "",
    statsPeriod = DEFAULT_REPLAY_PERIOD,
    project,
    environment,
    sort = DEFAULT_REPLAY_SORT,
    cursor,
    limit = REPLAY_PAGE_SIZE,
    signal,
  }: ListReplaysParams,
): Promise<{ data: Replay[]; nextCursor: string | null }> {
  const page = await client.request<ReplayIndexResponse>(`/organizations/${org}/replays/`, {
    query: {
      field: [...REPLAY_FIELDS],
      sort,
      query: query || undefined,
      statsPeriod,
      per_page: limit,
      cursor,
      project,
      environment,
      queryReferrer: "replayList",
    },
    signal,
  });

  return { data: unwrapReplays(page.data).map(normalise), nextCursor: page.nextCursor };
}

/** Fetch one replay by id, for a URL opened without first visiting the list. */
export async function fetchReplay(
  client: SentryClient,
  { org, replayId, signal }: { org: string; replayId: string; signal?: AbortSignal },
): Promise<Replay> {
  const page = await client.request<{ data?: unknown }>(
    `/organizations/${org}/replays/${replayId}/`,
    { signal },
  );
  const raw = page.data?.data;
  if (!isObject(raw)) throw new Error(`Replay ${replayId} was not found.`);
  return normalise(raw, 0);
}

export interface ListReplayErrorsParams {
  org: string;
  replayId: string;
  /**
   * The window to search. The replay itself was found inside this window, so
   * the same period necessarily covers its errors too.
   */
  statsPeriod?: string;
  environment?: string[];
  signal?: AbortSignal;
}

/** Fetch the error events recorded during one replay, oldest first. */
export async function listReplayErrors(
  client: SentryClient,
  {
    org,
    replayId,
    statsPeriod = DEFAULT_REPLAY_PERIOD,
    environment,
    signal,
  }: ListReplayErrorsParams,
): Promise<{ data: ReplayError[]; nextCursor: string | null }> {
  const page = await queryDiscover(client, {
    org,
    dataset: "errors",
    fields: REPLAY_ERROR_FIELDS,
    sort: "timestamp",
    query: `replayId:[${replayId}]`,
    statsPeriod,
    project: ALL_ACCESS_PROJECTS,
    environment,
    referrer: "sentry-tui.replay-details",
    signal,
  });

  return { data: page.rows.map(normaliseError), nextCursor: page.nextCursor };
}

/**
 * Where a replay lives in the web app.
 *
 * Built from `views/explore/replays/pathnames.tsx`, which puts replays under
 * `explore/replays/` rather than the legacy top-level route.
 */
export function replayUrl(org: string, replayId: string): string {
  return `${WEB_BASE_URL}/organizations/${org}/explore/replays/${replayId}/`;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Take the replay array out of whatever the endpoint returned.
 *
 * Same defence `queryDiscover` applies to `events/`: the body is `{data: []}`,
 * but a bare array would otherwise reach the renderer as `undefined.map`.
 */
function unwrapReplays(body: ReplayIndexResponse | unknown[] | undefined): RawReplay[] {
  const rows = Array.isArray(body) ? body : body?.data;
  return Array.isArray(rows) ? rows.filter(isObject) : [];
}

type RawReplay = Record<string, unknown>;

function isObject(value: unknown): value is RawReplay {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reshape one wire object into the `Replay` the UI renders. */
function normalise(raw: RawReplay, index: number): Replay {
  return {
    id: str(raw["id"]) ?? String(index),
    projectId: str(raw["project_id"]),
    isArchived: raw["is_archived"] === true,
    hasViewed: raw["has_viewed"] === true,
    user: user(raw["user"]),
    startedAt: str(raw["started_at"]) ?? "",
    finishedAt: str(raw["finished_at"]) ?? "",
    durationSec: num(raw["duration"]),
    os: agent(raw["os"]),
    browser: agent(raw["browser"]),
    device: device(raw["device"]),
    sdk: agent(raw["sdk"]),
    platform: str(raw["platform"]),
    environment: str(raw["environment"]),
    releases: strings(raw["releases"]),
    activity: num(raw["activity"]),
    countErrors: num(raw["count_errors"]),
    countDeadClicks: num(raw["count_dead_clicks"]),
    countRageClicks: num(raw["count_rage_clicks"]),
    countUrls: num(raw["count_urls"]),
    countSegments: num(raw["count_segments"]),
    errorIds: strings(raw["error_ids"]),
    traceIds: strings(raw["trace_ids"]),
    urls: strings(raw["urls"]),
  };
}

/** Reshape a flat Discover row into a `ReplayError`. */
function normaliseError(row: DiscoverRow, index: number): ReplayError {
  return {
    id: rowString(row, "id") ?? String(index),
    title: rowString(row, "title") ?? "",
    issue: rowString(row, "issue"),
    level: rowString(row, "level"),
    projectName: rowString(row, "project.name"),
    timestamp: rowString(row, "timestamp") ?? "",
  };
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function num(value: unknown): number | undefined {
  // Not `Number(value)` alone: an archived replay reports `duration: null`
  // for every numeric field, and `Number(null)` is a perfectly finite 0 — a
  // deleted recording would claim to be zero seconds long.
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((entry): entry is string => entry !== undefined);
}

function agent(value: unknown): ReplayAgent {
  if (!isObject(value)) return {};
  return { name: str(value["name"]), version: str(value["version"]) };
}

function device(value: unknown): Replay["device"] {
  if (!isObject(value)) return {};
  return {
    name: str(value["name"]),
    version: str(value["model_id"]),
    brand: str(value["brand"]),
    family: str(value["family"]),
  };
}

function user(value: unknown): ReplayUser {
  if (!isObject(value)) return {};
  return {
    displayName: str(value["display_name"]),
    email: str(value["email"]),
    id: str(value["id"]),
    ip: str(value["ip"]),
    username: str(value["username"]),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * A replay's length, as a video's runtime: `2:05`, `1:04:12`.
 *
 * The web renders this through `<Duration precision="sec">`; a session is a
 * recording, and a recording's length reads as a clock rather than as `125s`.
 */
export function formatReplayDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return "—";
  const total = Math.round(seconds);
  const secs = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * A name and its major version: `Chrome 120`, `Android 14`, `Mac OS X`.
 *
 * The web draws an icon here and puts `name version` in a tooltip. A terminal
 * has no tooltip and rarely has the icon, so the text is the cell, trimmed to
 * the major version — the part that distinguishes one session from another.
 *
 * A version that isn't a plain number is dropped rather than trimmed. Browsers
 * report an exact version, but a desktop OS sniffed from a user agent reports a
 * range: real Chrome-on-macOS sessions come back as `">=10.15.7"`, and both
 * `">=10"` and `"10"` say something false about a machine running 15.
 */
export function formatAgent(value: ReplayAgent): string {
  if (!value.name) return "—";
  const version = value.version;
  if (!version || !/^\d/.test(version)) return value.name;
  return `${value.name} ${version.split(".")[0]}`;
}

/** First eight characters of an id, as `utils/events.tsx:getShortEventId` does. */
export function shortReplayId(id: string): string {
  return id.slice(0, 8);
}
