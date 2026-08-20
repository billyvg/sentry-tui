/**
 * The Issues secondary-nav items, as queries.
 *
 * Every item under Issues except "All Views" is the same
 * `/organizations/:org/issues/` list with a different query — the web app
 * builds them as one-page-per-query components under
 * `sentry/static/app/views/issueList/pages/`. This table is the TUI's
 * equivalent, keyed by the label `NAV_GROUPS` renders so the nav and the data
 * can't drift apart. `src/core/issueViews.test.ts` asserts that they haven't.
 */

import { DEFAULT_QUERY, type SortOption } from "~/api/issues";

/** The one Issues item that isn't a query — it lists saved searches. */
export const ALL_VIEWS_LABEL = "All Views";

export interface IssueView {
  /** Matches a secondary-nav item label in `NAV_GROUPS`. */
  label: string;
  query: string;
  /** Omitted means `DEFAULT_SORT`. */
  sort?: SortOption;
  /** The web's `titleDescription`, shown beside the title in the header. */
  description: string;
}

/**
 * Issue category values from `sentry/static/app/types/group.tsx`, grouped as
 * `ISSUE_TAXONOMY_CONFIG` (`views/issueList/taxonomies.tsx`) groups them. The
 * taxonomy pages all build `is:unresolved issue.category:[…]` from these.
 */
function categoryQuery(categories: readonly string[]): string {
  return `is:unresolved issue.category:[${categories.join(",")}]`;
}

export const ISSUE_VIEWS: readonly IssueView[] = [
  {
    label: "Feed",
    query: DEFAULT_QUERY,
    description: "High and medium priority issues across your projects.",
  },
  {
    // The web's Inbox (`pages/inbox.tsx`) is five collapsible sections, one
    // query per progress state, plus a me / my-teams / all segmented control.
    // The TUI flattens that to the union of those queries sorted by progress —
    // same rows, no grouping — because a single scrolling list is the shape
    // the rest of this app already knows how to render and drive.
    label: "Inbox",
    query:
      "is:unresolved issue.progress:[fix_proposed,diagnosed,assigned,identified,fix_applied] " +
      "assigned_or_suggested:me " +
      // `INBOX_AUTOFIX_CATEGORY_FILTER` from `views/issueList/queries/inbox.ts`.
      "issue.category:[error,mobile,frontend,db_query,http_client,configuration]",
    sort: "progress",
    description: "Issues assigned or suggested to you that Seer has moved along.",
  },
  {
    label: "Errors & Outages",
    query: categoryQuery(["error", "outage"]),
    description:
      "Issues that break functionality such as application errors, failed jobs, or downtime incidents.",
  },
  {
    label: "Breached Metrics",
    query: categoryQuery(["metric"]),
    description:
      "Issues that indicate degraded system behavior such as endpoint latency regressions or metric threshold violations.",
  },
  {
    label: "Warnings",
    query: categoryQuery(["db_query", "http_client", "frontend", "mobile"]),
    description:
      "Issues in your code or configuration that may not break functionality but can degrade performance or user experience.",
  },
  {
    label: "Configuration",
    query: categoryQuery(["configuration"]),
    description:
      "Issues detected from SDK or tooling configuration problems that degrade your ability to debug telemetry using Sentry.",
  },
  {
    // The web renders feedback in a bespoke mailbox UI, but it reads the same
    // issues endpoint — see `components/feedback/useFeedbackListApiOptions.tsx`,
    // whose default mailbox is `unresolved`.
    label: "User Feedback",
    query: "issue.category:feedback status:unresolved",
    description: "Feedback submitted by your users.",
  },
  {
    label: "Recently Run",
    query: "is:unresolved has:issue.seer_last_run",
    description: "Issues where Seer has identified a root cause.",
  },
];

const BY_LABEL = new Map(ISSUE_VIEWS.map((view) => [view.label, view]));

/** The view a secondary-nav label selects, or undefined if it isn't a query. */
export function getIssueView(label: string): IssueView | undefined {
  return BY_LABEL.get(label);
}

/** The view the app opens on. */
export const DEFAULT_ISSUE_VIEW: IssueView = ISSUE_VIEWS[0]!;
