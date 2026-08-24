import type { Page, SentryClient } from "~/api/client";
import type {
  Group,
  GroupStatus,
  GroupSubstatus,
  Organization,
  OrgMember,
  PriorityLevel,
  Project,
  SentryEvent,
  TimeseriesValue,
} from "~/api/types";

/** The issue stream's default query, from `views/issueList/utils.tsx`. */
export const DEFAULT_QUERY = "is:unresolved issue.priority:[high, medium]";
export const DEFAULT_STATS_PERIOD = "14d";
/** The stats window the sparkline shows, independent of the query period. */
export const DEFAULT_GRAPH_STATS_PERIOD = "24h";
export const PAGE_SIZE = 25;

export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "date", label: "Last Seen" },
  { value: "new", label: "Age" },
  { value: "trends", label: "Trends" },
  { value: "freq", label: "Events" },
  { value: "user", label: "Users" },
  { value: "inbox", label: "Date Added" },
  { value: "progress", label: "Progress" },
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number]["value"];
export const DEFAULT_SORT: SortOption = "date";

/** Narrow persisted screen state to one of the issue endpoint's sort values. */
export function issueSort(value: string): SortOption {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SortOption)
    : DEFAULT_SORT;
}

export interface ListIssuesParams {
  org: string;
  query?: string;
  sort?: SortOption;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Phase one of the issue fetch: everything except the expensive per-issue
 * stats. The web app does the same (`collapse: ['stats', 'unhandled']`) so the
 * list paints before the graphs are computed.
 */
export async function listIssues(
  client: SentryClient,
  {
    org,
    query = DEFAULT_QUERY,
    sort = DEFAULT_SORT,
    statsPeriod = DEFAULT_STATS_PERIOD,
    project,
    environment,
    cursor,
    limit = PAGE_SIZE,
    signal,
  }: ListIssuesParams,
): Promise<Page<Group[]>> {
  return client.request<Group[]>(`/organizations/${org}/issues/`, {
    query: {
      query,
      sort,
      statsPeriod,
      limit,
      shortIdLookup: 1,
      cursor,
      project,
      environment,
      expand: ["owners", "inbox"],
      collapse: ["stats", "unhandled"],
    },
    signal,
  });
}

/**
 * One entry from `/issues-stats/`.
 *
 * `collapse=stats` on the list request strips more than the graph data — the
 * counts and seen timestamps come back here too, which is why phase two fills
 * in numbers as well as sparklines.
 */
export interface IssueStatsEntry {
  id: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  isUnhandled?: boolean;
  stats?: Record<string, TimeseriesValue[]>;
}

/** Stats keyed by issue id, for merging back onto the list. */
export type IssueStats = Record<string, IssueStatsEntry>;

/**
 * Phase two: counts and sparkline data for the ids just returned, so rows can
 * be read and navigated while the graphs are still in flight.
 */
export async function fetchIssueStats(
  client: SentryClient,
  {
    org,
    groups,
    statsPeriod = DEFAULT_STATS_PERIOD,
    groupStatsPeriod = DEFAULT_GRAPH_STATS_PERIOD,
    signal,
  }: {
    org: string;
    groups: string[];
    statsPeriod?: string;
    groupStatsPeriod?: string;
    signal?: AbortSignal;
  },
): Promise<IssueStats> {
  if (groups.length === 0) return {};
  // The endpoint returns an array of entries carrying their own `id`, not an
  // object keyed by issue id — key it here so callers can merge by lookup.
  const page = await client.request<IssueStatsEntry[]>(`/organizations/${org}/issues-stats/`, {
    query: { groups, statsPeriod, groupStatsPeriod },
    signal,
  });
  const entries = Array.isArray(page.data) ? page.data : [];
  return Object.fromEntries(entries.map((entry) => [entry.id, entry]));
}

export async function fetchIssue(
  client: SentryClient,
  { org, issueId, signal }: { org: string; issueId: string; signal?: AbortSignal },
): Promise<Group> {
  const page = await client.request<Group>(`/organizations/${org}/issues/${issueId}/`, { signal });
  return page.data;
}

export type EventSelector = "latest" | "oldest" | "recommended" | (string & {});

export async function fetchIssueEvent(
  client: SentryClient,
  {
    org,
    issueId,
    eventId = "latest",
    signal,
  }: {
    org: string;
    issueId: string;
    eventId?: EventSelector;
    signal?: AbortSignal;
  },
): Promise<SentryEvent> {
  const page = await client.request<SentryEvent>(
    `/organizations/${org}/issues/${issueId}/events/${eventId}/`,
    { signal },
  );
  return page.data;
}

export interface IssueUpdate {
  status?: GroupStatus;
  substatus?: GroupSubstatus;
  /** `user:<id>`, `team:<id>`, or an email/username. */
  assignedTo?: string | null;
  isBookmarked?: boolean;
  isSubscribed?: boolean;
  hasSeen?: boolean;
  inbox?: boolean;
  priority?: PriorityLevel;
}

export async function updateIssue(
  client: SentryClient,
  {
    org,
    issueId,
    update,
    signal,
  }: {
    org: string;
    issueId: string;
    update: IssueUpdate;
    signal?: AbortSignal;
  },
): Promise<Group> {
  const page = await client.request<Group>(`/organizations/${org}/issues/${issueId}/`, {
    method: "PUT",
    body: update,
    signal,
  });
  return page.data;
}

/** Fetch a single organization's details, including its avatar. */
export async function getOrganization(
  client: SentryClient,
  { org, signal }: { org: string; signal?: AbortSignal },
): Promise<Organization> {
  const page = await client.request<Organization>(`/organizations/${org}/`, {
    signal,
  });
  return page.data;
}

export async function listOrganizations(
  client: SentryClient,
  signal?: AbortSignal,
): Promise<Organization[]> {
  const page = await client.request<Organization[]>("/organizations/", {
    signal,
  });
  return page.data;
}

/**
 * Every member of an organization, each carrying their account's avatar
 * settings — the only place the API exposes them, since an issue's
 * `assignedTo` actor is just an id, a name and a type.
 *
 * Unpaginated by design on Sentry's side: one request returns the whole
 * member list, so callers should fetch it once and cache it.
 */
export async function listOrganizationMembers(
  client: SentryClient,
  { org, signal }: { org: string; signal?: AbortSignal },
): Promise<OrgMember[]> {
  const page = await client.request<OrgMember[]>(`/organizations/${org}/users/`, { signal });
  return page.data;
}

/** The endpoint's documented maximum, and what every caller here asks for. */
export const PROJECTS_PER_PAGE = 100;

export interface ListProjectsOptions {
  org: string;
  /**
   * Search text, matched by the server as a substring of a project's slug *or*
   * its name. A row can therefore come back for a reason its slug does not
   * show, and a non-contiguous query (`mios` for `mobile-ios`) matches
   * nothing — the picker fuzzy-matches what it already holds alongside this.
   */
  query?: string;
  perPage?: number;
  signal?: AbortSignal;
}

/**
 * One page of the organization's projects — the first, unless a `query` picks
 * out others.
 *
 * An org can have more projects than a page holds, and there is no cursor
 * followed here: a caller that needs a project outside the first page asks for
 * it by name.
 */
export async function listProjects(
  client: SentryClient,
  { org, query, perPage = PROJECTS_PER_PAGE, signal }: ListProjectsOptions,
): Promise<Project[]> {
  const page = await client.request<Project[]>(`/organizations/${org}/projects/`, {
    query: { query: query?.trim() || undefined, per_page: perPage },
    signal,
  });
  return page.data;
}

export interface Environment {
  id: string;
  name: string;
}

/** Fetch visible environments for the organization. */
export async function listEnvironments(
  client: SentryClient,
  { org, signal }: { org: string; signal?: AbortSignal },
): Promise<Environment[]> {
  const page = await client.request<Environment[]>(`/organizations/${org}/environments/`, {
    signal,
  });
  return page.data;
}
