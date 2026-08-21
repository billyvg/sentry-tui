/**
 * Deterministic workflows (automations) API data for `Monitors › Alerts`.
 *
 * Kept beside `dashboard-fixtures.ts` rather than in `fixtures.ts` for the
 * same reason: these are one feature's responses, and several people are
 * adding one such file each.
 */

import type { Detector } from "~/api/detectors";
import type { Workflow } from "~/api/workflows";
import type { Project } from "~/api/types";

/**
 * `GET /organizations/{org}/workflows/`.
 *
 * One row per shape the columns have to survive: a healthy multi-action
 * workflow across two projects, a disabled one with no actions and nothing
 * connected, and one wired to the org-wide detector so the Projects cell has
 * to say "All Projects" rather than list every slug.
 */
export const workflowsFixture: Workflow[] = [
  {
    id: "1001",
    name: "Page on-call for checkout",
    enabled: true,
    detectorIds: ["501", "502"],
    lastTriggered: "2026-08-21T09:00:00Z",
    environment: "production",
    dateCreated: "2026-04-02T10:00:00Z",
    dateUpdated: "2026-08-01T10:00:00Z",
    triggers: null,
    actionFilters: [
      {
        id: "f-1",
        logicType: "any",
        actions: [
          { id: "a-1", type: "slack", status: "active" },
          // Repeated on purpose: the cell lists distinct integrations, not
          // one entry per configured action.
          { id: "a-2", type: "slack", status: "active" },
        ],
      },
      { id: "f-2", logicType: "all", actions: [{ id: "a-3", type: "email", status: "active" }] },
    ],
  },
  {
    id: "1002",
    name: "Archive noisy warnings",
    enabled: false,
    detectorIds: [],
    lastTriggered: null,
    environment: null,
    dateCreated: "2026-02-11T10:00:00Z",
    dateUpdated: "2026-02-11T10:00:00Z",
    triggers: null,
    actionFilters: [],
  },
  {
    id: "1003",
    name: "Jira ticket per new issue",
    enabled: true,
    detectorIds: ["900"],
    lastTriggered: "2026-08-14T09:00:00Z",
    environment: null,
    dateCreated: "2026-01-05T10:00:00Z",
    dateUpdated: "2026-06-05T10:00:00Z",
    triggers: null,
    actionFilters: [
      { id: "f-3", logicType: "any", actions: [{ id: "a-4", type: "jira", status: "active" }] },
    ],
  },
];

/**
 * `GET /organizations/{org}/detectors/?id=…` — the connected detectors the
 * Projects column resolves. `900` is the org-wide detector, whose null
 * `projectId` is what "All Projects" is read from.
 */
export const workflowDetectorsFixture: Detector[] = [
  { id: "501", name: "Checkout error rate", type: "error", enabled: true, projectId: "42" },
  { id: "502", name: "Checkout latency", type: "metric_issue", enabled: true, projectId: "43" },
  {
    id: "900",
    name: "Issue Stream: All Projects",
    type: "issue_stream",
    enabled: true,
    projectId: null,
  },
];

/** `GET /organizations/{org}/projects/` — the id → slug mapping. */
export const workflowProjectsFixture: Project[] = [
  { id: "42", slug: "backend", name: "Backend", platform: "python" },
  { id: "43", slug: "frontend", name: "Frontend", platform: "javascript" },
];
