import { describe, expect, test } from "bun:test";

import { DEFAULT_TIMELINE_WINDOW_SECONDS } from "~/api/monitorStats";
import { timelineWindowLabel } from "~/core/checkInTimeline";

describe("timelineWindowLabel", () => {
  /**
   * A timeline has no axis — not in the list's column and not on the detail
   * pane — so this label is the only place a reader learns what the cells add
   * up to. Two callers print it, and this is what stops them disagreeing with
   * each other or with the window actually requested.
   */
  test("names the window the stats are actually fetched for", () => {
    expect(timelineWindowLabel()).toBe(timelineWindowLabel(DEFAULT_TIMELINE_WINDOW_SECONDS));
    expect(timelineWindowLabel()).toBe("Last 24 hours");
  });

  test("follows the window if it changes", () => {
    expect(timelineWindowLabel(3600)).toBe("Last hour");
    expect(timelineWindowLabel(6 * 3600)).toBe("Last 6 hours");
    expect(timelineWindowLabel(24 * 3600)).toBe("Last 24 hours");
    expect(timelineWindowLabel(7 * 24 * 3600)).toBe("Last 7 days");
    // Not a whole number of days: hours rather than a rounded-off lie.
    expect(timelineWindowLabel(36 * 3600)).toBe("Last 36 hours");
  });

  test("degrades rather than saying something absurd", () => {
    expect(timelineWindowLabel(0)).toBe("Last hour");
    expect(timelineWindowLabel(60)).toBe("Last hour");
  });
});
