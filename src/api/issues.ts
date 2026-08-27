import {
  getOrganization as getOrganizationRequest,
  type ListOrganizationProjectsData,
  listOrganizationEnvironments,
  listOrganizationProjects,
  listOrganizations as listOrganizationsRequest,
} from "@sentry/api";

import type { Page, SentryClient } from "~/api/client";
import { projectParams } from "~/api/projectParams";
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
      project: projectParams(project),
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
    project,
    signal,
  }: {
    org: string;
    groups: string[];
    statsPeriod?: string;
    groupStatsPeriod?: string;
    project?: string[];
    signal?: AbortSignal;
  },
): Promise<IssueStats> {
  if (groups.length === 0) return {};
  // The endpoint returns an array of entries carrying their own `id`, not an
  // object keyed by issue id — key it here so callers can merge by lookup.
  const page = await client.request<IssueStatsEntry[]>(`/organizations/${org}/issues-stats/`, {
    query: { groups, statsPeriod, groupStatsPeriod, project: projectParams(project) },
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
  const { data } = await getOrganizationRequest({
    ...client.generatedOptions(signal),
    path: { organization_id_or_slug: org },
  });
  return organizationFromResponse(data);
}

export interface CurrentUser {
  id?: string;
  name?: string;
  email?: string;
}

/** Fetch the authenticated account for ownership and employee-only controls. */
export async function getCurrentUser(
  client: SentryClient,
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const page = await client.request<Record<string, unknown>>("/users/me/", { signal });
  const value =
    page.data && typeof page.data === "object"
      ? (page.data as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
    ...(typeof value["id"] === "string" ? { id: value["id"] } : {}),
    ...(typeof value["name"] === "string" ? { name: value["name"] } : {}),
    ...(typeof value["email"] === "string" ? { email: value["email"] } : {}),
  };
}

export async function listOrganizations(
  client: SentryClient,
  signal?: AbortSignal,
): Promise<Organization[]> {
  const { data } = await listOrganizationsRequest(client.generatedOptions(signal));
  return data.map(organizationFromResponse);
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

/** Expensive summary fields Sentry's own frontend omits from project lists. */
const LIGHTWEIGHT_PROJECT_COLLAPSE = ["latestDeploys", "unusedFeatures"];

type LightweightProjectQuery = NonNullable<ListOrganizationProjectsData["query"]> & {
  /** Supported by the endpoint but missing from its generated OpenAPI query type. */
  collapse: string[];
};

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
  const projectQuery: LightweightProjectQuery = {
    query: query?.trim() || undefined,
    per_page: perPage,
    collapse: LIGHTWEIGHT_PROJECT_COLLAPSE,
  };
  const { data } = await listOrganizationProjects({
    ...client.generatedOptions(signal),
    path: { organization_id_or_slug: org },
    query: projectQuery,
  });
  return projectsFromResponse(data);
}

export interface ProjectReference {
  id: string;
  slug: string;
}

/**
 * Resolve only the projects referenced by the current rows.
 *
 * The organization-projects list accepts repeated `id:` search tokens and
 * returns `ProjectSummarySerializer`, rather than full project details. Sentry's
 * standard collapse flags suppress its expensive deploy and unused-feature
 * fields; this client retains only the id and slug from that summary. Requests
 * are bounded to the endpoint's 100-row maximum regardless of org size.
 */
export async function listProjectReferences(
  client: SentryClient,
  { org, ids, signal }: { org: string; ids: readonly string[]; signal?: AbortSignal },
): Promise<ProjectReference[]> {
  const uniqueIds = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  const projects: ProjectReference[] = [];

  for (let offset = 0; offset < uniqueIds.length; offset += PROJECTS_PER_PAGE) {
    const batch = uniqueIds.slice(offset, offset + PROJECTS_PER_PAGE);
    const projectQuery: LightweightProjectQuery = {
      query: batch.map((id) => `id:${id}`).join(" "),
      per_page: batch.length,
      collapse: LIGHTWEIGHT_PROJECT_COLLAPSE,
    };
    const { data } = await listOrganizationProjects({
      ...client.generatedOptions(signal),
      path: { organization_id_or_slug: org },
      query: projectQuery,
    });
    projects.push(...data.map(({ id, slug }) => ({ id, slug })));
  }

  return projects;
}

/** Keep the app's project model independent of generated response extras. */
function projectsFromResponse(
  data: ReadonlyArray<{
    id: string;
    slug: string;
    name: string;
    platform?: string | null;
  }>,
): Project[] {
  return data.map(({ id, slug, name, platform }) => ({ id, slug, name, platform }));
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
  const { data } = await listOrganizationEnvironments({
    ...client.generatedOptions(signal),
    path: { organization_id_or_slug: org },
  });
  return data;
}

/** Keep the app's small organization model independent of generated extras. */
function organizationFromResponse(value: {
  id: string;
  slug: string;
  name: string;
  features?: string[];
  avatar?: { avatarType?: string; avatarUuid?: string | null; avatarUrl?: string | null };
}): Organization {
  const avatar = value.avatar;
  return {
    id: value.id,
    slug: value.slug,
    name: value.name,
    features: value.features,
    ...(avatar?.avatarType
      ? {
          avatar: {
            avatarType: avatar.avatarType as NonNullable<Organization["avatar"]>["avatarType"],
            avatarUuid: avatar.avatarUuid ?? null,
            avatarUrl: avatar.avatarUrl,
          },
        }
      : {}),
  };
}
