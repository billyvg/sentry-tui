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
import { IssueFeed } from "~/ui/screens/IssueFeed";
import { IssueViews } from "~/ui/screens/IssueViews";
import { LogStream } from "~/ui/screens/LogStream";
import { SeerScreen } from "~/ui/screens/SeerScreen";
import { ProfileFunctions } from "~/ui/screens/ProfileFunctions";
import { ReleaseCards } from "~/ui/screens/ReleaseCards";
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
  "explore.logs": LogStream,
  "seer.ask": SeerScreen,
  "explore.profiles": ProfileFunctions,
  "explore.releases": ReleaseCards,
};
