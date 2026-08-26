/**
 * Screen id → component.
 *
 * The only place a screen is wired into the app. `App` looks a screen up here
 * and renders it with `ScreenProps`; an id with no entry renders the
 * placeholder pane instead, which is why the registry in `core/screens.ts` can
 * be complete long before the screens are.
 *
 * Keep this a flat, one-entry-per-line object literal — several people are
 * adding a line to it at once, and a line each is a merge conflict nobody has
 * to resolve.
 */

import type { ScreenId } from "~/core/screens";
import { ConversationList } from "~/ui/screens/ConversationList";
import { ExploreTable } from "~/ui/screens/ExploreTable";
import { DashboardList } from "~/ui/screens/DashboardList";
import { IssueFeed } from "~/ui/screens/IssueFeed";
import { IssueViews } from "~/ui/screens/IssueViews";
import { MonitorList } from "~/ui/screens/MonitorList";
import { SeerScreen } from "~/ui/screens/SeerScreen";
import { ProfileFunctions } from "~/ui/screens/ProfileFunctions";
import { ReleaseCards } from "~/ui/screens/ReleaseCards";
import { ReplayStream } from "~/ui/screens/ReplayStream";
import { SavedQueries } from "~/ui/screens/SavedQueries";
import { WorkflowList } from "~/ui/screens/WorkflowList";
import type { ScreenComponent } from "~/ui/screens/types";

export type {
  DetailContext,
  ScreenActions,
  ScreenComponent,
  ScreenProps,
  ViewStackEntry,
} from "~/ui/screens/types";

export const SCREEN_COMPONENTS: Partial<Record<ScreenId, ScreenComponent>> = {
  // Issues — every item but All Views is the same stream under the query
  // `core/issueViews.ts` gives it; All Views lists saved searches instead.
  "issues.feed": IssueFeed,
  "issues.inbox": IssueFeed,
  "issues.errors-outages": IssueFeed,
  "issues.breached-metrics": IssueFeed,
  "issues.warnings": IssueFeed,
  "issues.configuration": IssueFeed,
  "issues.user-feedback": IssueFeed,
  "issues.recently-run": IssueFeed,
  "issues.all-views": IssueViews,
  "seer.ask": SeerScreen,
  "explore.profiles": ProfileFunctions,
  "explore.releases": ReleaseCards,
  "explore.replays": ReplayStream,
  // Explore — one Discover table per `core/exploreTables.ts` config row.
  // Conversations is not one of them: its rows are pre-aggregated by
  // `/ai-conversations/`, so it is its own screen.
  "explore.traces": ExploreTable,
  "explore.logs": ExploreTable,
  "explore.metrics": ExploreTable,
  "explore.errors": ExploreTable,
  "explore.conversations": ConversationList,
  // Dashboards — both destinations are the same list under the filter
  // `core/dashboards.ts` gives them.
  "dashboards.all": DashboardList,
  "dashboards.sentry-built": DashboardList,
  "monitors.alerts": WorkflowList,
  "explore.all-queries": SavedQueries,
  "explore.discover": SavedQueries,
  // Monitors — all seven are the detector table under the filter
  // `core/monitors.ts` gives them.
  "monitors.all": MonitorList,
  "monitors.mine": MonitorList,
  "monitors.error": MonitorList,
  "monitors.metric": MonitorList,
  "monitors.cron": MonitorList,
  "monitors.uptime": MonitorList,
  "monitors.mobile-build": MonitorList,
};
