/**
 * Workflows — the automations behind `Monitors › Alerts`.
 *
 * Not the legacy alert rules: the sidebar's Alerts item is
 * `analyticsItemName="monitors_automations"`
 * (`monitorsSecondaryNavigation.tsx:95`), which routes to
 * `views/automations/list.tsx` and reads
 * `GET /organizations/{org}/workflows/` (`views/automations/hooks/index.tsx:58`).
 * The response shape is `WorkflowSerializerResponse` in
 * `workflow_engine/endpoints/serializers/workflow_serializer.py`.
 *
 * A workflow says *when* to act and *what* action to take; the detectors it is
 * connected to say what it watches. Those come back as bare ids, so the
 * Projects column needs a second call — `listDetectorsByIds` in
 * `api/detectors.ts`, which is the one module that talks to that endpoint.
 *
 * Read-only: nothing here enables, disables, or deletes a workflow.
 */

import type { Page, SentryClient } from "~/api/client";
import { projectParams } from "~/api/projectParams";

/**
 * An action a workflow fires, as `ActionType` in
 * `types/workflowEngine/actions.tsx:38-53`.
 *
 * Left open (`string & {}`) because integrations are added server-side: an
 * unknown type must render as itself rather than fail to type-check.
 */
export type WorkflowActionType =
  | "slack"
  | "slack_staging"
  | "msteams"
  | "discord"
  | "pagerduty"
  | "opsgenie"
  | "github"
  | "github_enterprise"
  | "jira"
  | "jira_server"
  | "vsts"
  | "email"
  | "sentry_app"
  | "plugin"
  | "webhook"
  | (string & {});

/** One action on a workflow's action filter. */
export interface WorkflowAction {
  id: string;
  type: WorkflowActionType;
  /** `ObjectStatus` — `"disabled"` means it is configured but cannot run. */
  status?: string;
  integrationId?: string | null;
}

/**
 * A data condition group: the workflow's trigger, or one of its action
 * filters. Only the actions matter to the list.
 */
export interface WorkflowConditionGroup {
  id: string;
  logicType?: string;
  actions?: WorkflowAction[];
}

/** A row of `GET /organizations/{org}/workflows/`. */
export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  /** Ids of the detectors this workflow watches; `[]` when unconnected. */
  detectorIds: string[];
  /** Condition groups that gate the actions, each carrying its own actions. */
  actionFilters: WorkflowConditionGroup[] | null;
  triggers?: WorkflowConditionGroup | null;
  /** When it last fired, or null if it never has. */
  lastTriggered?: string | null;
  environment?: string | null;
  dateCreated?: string;
  dateUpdated?: string;
  createdBy?: string | null;
  owner?: string | null;
}

/**
 * Sort fields `SORT_COL_MAP` accepts
 * (`organization_workflow_index.py:78-86`), `-` prefixed for descending.
 */
type WorkflowSortField =
  | "name"
  | "id"
  | "dateCreated"
  | "dateUpdated"
  | "connectedDetectors"
  | "actions"
  | "lastTriggered";

export type WorkflowSort = WorkflowSortField | `-${WorkflowSortField}`;

export const WORKFLOW_SORT_OPTIONS = [
  { value: "-lastTriggered", label: "Last Triggered (newest)" },
  { value: "lastTriggered", label: "Last Triggered (oldest)" },
  { value: "name", label: "Name (A-Z)" },
  { value: "-name", label: "Name (Z-A)" },
  { value: "-actions", label: "Most Actions" },
  { value: "actions", label: "Fewest Actions" },
  { value: "-connectedDetectors", label: "Most Monitors" },
  { value: "connectedDetectors", label: "Fewest Monitors" },
] as const satisfies ReadonlyArray<{ value: WorkflowSort; label: string }>;

/**
 * What the list opens on.
 *
 * The endpoint itself defaults to `id`; the web's list pins
 * `{kind: 'desc', field: 'lastTriggered'}`
 * (`useAutomationListDetectors.ts:31`), which is the order that answers
 * "what has been going off".
 */
export const DEFAULT_WORKFLOW_SORT: WorkflowSort = "-lastTriggered";

/** Resolve alert-list state to a workflow endpoint sort. */
export function workflowSort(value: string): WorkflowSort {
  return WORKFLOW_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as WorkflowSort)
    : DEFAULT_WORKFLOW_SORT;
}

/**
 * Rows fetched in one go.
 *
 * The web pages at `AUTOMATION_LIST_PAGE_LIMIT = 20`
 * (`views/automations/constants.tsx:1`); the terminal scrolls rather than
 * paging, so it asks for more at once.
 */
export const WORKFLOWS_PAGE_SIZE = 50;

export interface ListWorkflowsParams {
  org: string;
  /**
   * Only workflows connected to these detectors — the `detector` query param,
   * repeated. This is what a monitor's detail view asks for, where the web
   * sends `automationsApiOptions(org, {detector: [detectorId]})`
   * (`details/common/automations.tsx:74`).
   */
  detector?: string[];
  /** Free text, or `name:` / `action:` / `created_by:` — the endpoint's
   * `workflow_search_config` allows those three keys and free text on name. */
  query?: string;
  /** Project ids or slugs. Empty means every accessible project. */
  project?: string[];
  sortBy?: WorkflowSort;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/** List the org's workflows. */
export async function listWorkflows(
  client: SentryClient,
  {
    org,
    detector,
    query,
    project,
    sortBy = DEFAULT_WORKFLOW_SORT,
    limit = WORKFLOWS_PAGE_SIZE,
    cursor,
    signal,
  }: ListWorkflowsParams,
): Promise<Page<Workflow[]>> {
  return client.request<Workflow[]>(`/organizations/${org}/workflows/`, {
    query: {
      detector,
      query: query || undefined,
      project: projectParams(project),
      sortBy,
      per_page: limit,
      cursor,
    },
    signal,
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Display names for the action types, from `ActionMetadata`
 * (`components/workflowEngine/ui/actionMetadata.tsx:19-77`). The web draws an
 * integration logo beside each; a terminal has the name and nothing else, so
 * the name has to carry the cell.
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  vsts: "Azure DevOps",
  discord: "Discord",
  email: "Email",
  github: "GitHub",
  github_enterprise: "GitHub Enterprise",
  jira: "JIRA",
  jira_server: "JIRA Server",
  msteams: "Teams",
  opsgenie: "Opsgenie",
  pagerduty: "Pagerduty",
  plugin: "Plugin",
  sentry_app: "Sentry App",
  slack: "Slack",
  slack_staging: "Slack (Staging)",
  webhook: "Webhook",
};

/** Human name for an action type, falling back to the raw type. */
export function actionTypeLabel(type: WorkflowActionType): string {
  return ACTION_LABELS[type] ?? type;
}

/**
 * The distinct action types a workflow fires, in first-seen order.
 *
 * Mirrors `getAutomationActions` (`views/automations/hooks/utils.tsx:12-22`):
 * flattened across every action filter, deduplicated, because the cell answers
 * "where does this notify" rather than "how many times".
 */
export function workflowActionTypes(workflow: Workflow): WorkflowActionType[] {
  const seen = new Set<WorkflowActionType>();
  for (const group of workflow.actionFilters ?? []) {
    for (const action of group.actions ?? []) {
      if (action?.type) seen.add(action.type);
    }
  }
  return [...seen];
}
