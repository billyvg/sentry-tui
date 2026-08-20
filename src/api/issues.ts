import type { Page, SentryClient } from "~/api/client";
import type {
  Group,
  GroupStatus,
  GroupSubstatus,
  Organization,
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
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number]["value"];
export const DEFAULT_SORT: SortOption = "date";

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

export async function listProjects(
  client: SentryClient,
  { org, signal }: { org: string; signal?: AbortSignal },
): Promise<Project[]> {
  const page = await client.request<Project[]>(`/organizations/${org}/projects/`, { signal });
  return page.data;
}
