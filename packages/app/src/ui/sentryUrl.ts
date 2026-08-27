import type { SentryUrlDetail, SentryUrlState } from "~/core/sentryUrl";
import { dashboardUrlView } from "~/ui/screens/DashboardDetail";
import { issueUrlView } from "~/ui/screens/IssueFeed";
import { monitorUrlView } from "~/ui/screens/MonitorDetail";
import { replayUrlView } from "~/ui/screens/ReplayStream";
import type { ViewStackEntry } from "~/ui/screens/types";

/** Build the existing detail-view entry named by a parsed Sentry URL. */
export function viewForSentryUrl(
  detail: SentryUrlDetail | undefined,
  state?: SentryUrlState,
): ViewStackEntry | undefined {
  if (!detail) return undefined;

  let view: ViewStackEntry;
  switch (detail.kind) {
    case "issue":
      view = issueUrlView(detail.issueId, detail.eventId);
      break;
    case "dashboard":
      view = dashboardUrlView(detail.dashboardId);
      break;
    case "replay":
      view = replayUrlView(detail.replayId);
      break;
    case "monitor":
      view = monitorUrlView(detail.detectorId);
      break;
  }

  if (!view.stateKey || !state) return view;
  return { ...view, initialState: { ...view.initialState, ...state } };
}
