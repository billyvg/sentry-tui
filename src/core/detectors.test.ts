import { describe, expect, test } from "bun:test";

import type { Detector } from "~/api/detectors";
import {
  cronMonitor,
  cronScheduleText,
  detectorAssigneeLabel,
  detectorDetailParts,
  detectorTypeLabel,
  metricQuery,
  metricThresholdText,
  uptimeSubscription,
} from "~/core/detectors";

/** A detector with only the fields a case is about. */
function detector(overrides: Partial<Detector> & Pick<Detector, "type">): Detector {
  return { id: "1", name: "monitor", enabled: true, ...overrides };
}

const METRIC = detector({
  type: "metric_issue",
  config: { detectionType: "static" },
  conditionGroup: {
    conditions: [
      { type: "gt", comparison: 500, conditionResult: 75 },
      // Resolves the issue rather than opening one — never drawn.
      { type: "lt", comparison: 100, conditionResult: 0 },
    ],
  },
  dataSources: [
    {
      id: "20",
      type: "snuba_query_subscription",
      queryObj: {
        snubaQuery: {
          aggregate: "p95(span.duration)",
          query: "transaction:/checkout",
          environment: "production",
        },
      },
    },
  ],
});

describe("detectorTypeLabel", () => {
  test("names each type the way the web does", () => {
    expect(detectorTypeLabel("error")).toBe("Error");
    expect(detectorTypeLabel("metric_issue")).toBe("Metric");
    expect(detectorTypeLabel("monitor_check_in_failure")).toBe("Cron");
    expect(detectorTypeLabel("uptime_domain_failure")).toBe("Uptime");
    expect(detectorTypeLabel("preprod_size_analysis")).toBe("Mobile Build");
  });

  test("a type this client has never heard of still renders", () => {
    expect(detectorTypeLabel("something_new")).toBe("Unknown");
  });
});

describe("detectorAssigneeLabel", () => {
  test("prefers the name, falls back to the email", () => {
    expect(detectorAssigneeLabel({ name: "Ada Lovelace", type: "user" })).toBe("Ada Lovelace");
    expect(detectorAssigneeLabel({ email: "ada@example.com", type: "user" })).toBe(
      "ada@example.com",
    );
  });

  test("marks a team with the sigil the rest of Sentry uses", () => {
    expect(detectorAssigneeLabel({ name: "billing-team", type: "team" })).toBe("#billing-team");
    expect(detectorAssigneeLabel({ name: "#billing-team", type: "team" })).toBe("#billing-team");
  });

  test("unassigned reads as an em dash", () => {
    expect(detectorAssigneeLabel(null)).toBe("—");
    expect(detectorAssigneeLabel({ type: "user" })).toBe("—");
  });
});

describe("narrowing to a data source", () => {
  test("finds the one the detector has", () => {
    expect(metricQuery(METRIC)?.aggregate).toBe("p95(span.duration)");
    expect(uptimeSubscription(METRIC)).toBeUndefined();
    expect(cronMonitor(METRIC)).toBeUndefined();
  });

  test("a detector with no data sources at all yields nothing", () => {
    const bare = detector({ type: "metric_issue" });
    expect(metricQuery(bare)).toBeUndefined();
    expect(uptimeSubscription(bare)).toBeUndefined();
    expect(cronMonitor(bare)).toBeUndefined();
  });

  test("a data source whose queryObj came back null yields nothing", () => {
    const empty = detector({
      type: "monitor_check_in_failure",
      dataSources: [{ id: "1", type: "cron_monitor", queryObj: null }],
    });
    expect(cronMonitor(empty)).toBeUndefined();
  });
});

describe("cronScheduleText", () => {
  test("phrases a crontab", () => {
    expect(cronScheduleText({ schedule: "0 9 * * *", schedule_type: "crontab" })).toBe(
      "Every day at 09:00",
    );
  });

  test("phrases an interval", () => {
    expect(cronScheduleText({ schedule: [15, "minute"], schedule_type: "interval" })).toBe(
      "Every 15 minutes",
    );
  });

  test("falls back to the expression rather than to 'Unknown schedule'", () => {
    const raw = "0 3 1-5/2 * 1";
    expect(cronScheduleText({ schedule: raw })).toBe(raw);
  });

  test("says nothing when there is no schedule to say", () => {
    expect(cronScheduleText(undefined)).toBeUndefined();
    expect(cronScheduleText({ schedule: "" })).toBeUndefined();
  });
});

describe("metricThresholdText", () => {
  test("a static threshold carries its unit and the priority it opens at", () => {
    expect(metricThresholdText(METRIC)).toBe(">500ms high");
  });

  test("a count has no unit", () => {
    const counted = detector({
      type: "metric_issue",
      config: { detectionType: "static" },
      conditionGroup: { conditions: [{ type: "gte", comparison: 10, conditionResult: 50 }] },
      dataSources: [
        {
          id: "1",
          type: "snuba_query_subscription",
          queryObj: { snubaQuery: { aggregate: "count()" } },
        },
      ],
    });
    expect(metricThresholdText(counted)).toBe(">=10 medium");
  });

  test("a percent threshold is converted from a percentage of the baseline", () => {
    const percent = detector({
      type: "metric_issue",
      config: { detectionType: "percent", comparisonDelta: 3600 },
      conditionGroup: { conditions: [{ type: "gt", comparison: 110, conditionResult: 75 }] },
    });
    expect(metricThresholdText(percent)).toBe("10% higher than previous 1h");

    const lower = detector({
      type: "metric_issue",
      config: { detectionType: "percent", comparisonDelta: 86400 },
      conditionGroup: { conditions: [{ type: "lt", comparison: 60, conditionResult: 25 }] },
    });
    expect(metricThresholdText(lower)).toBe("40% lower than previous 1d");
  });

  test("anomaly detection says so instead of quoting a number", () => {
    const dynamic = detector({
      type: "metric_issue",
      config: { detectionType: "dynamic" },
      conditionGroup: { conditions: [{ type: "gt", comparison: {}, conditionResult: 75 }] },
    });
    expect(metricThresholdText(dynamic)).toBe("Dynamic");
  });

  test("a detector with no conditions has no threshold to show", () => {
    expect(metricThresholdText(detector({ type: "metric_issue" }))).toBeUndefined();
  });
});

describe("detectorDetailParts", () => {
  test("metric: project, environment, aggregate, query, threshold", () => {
    expect(detectorDetailParts(METRIC, { projectSlug: "checkout" })).toEqual([
      "checkout",
      "production",
      "p95(span.duration)",
      "transaction:/checkout",
      ">500ms high",
    ]);
  });

  test("uptime: project, url, interval — and the url is trimmed from the middle", () => {
    const uptime = detector({
      type: "uptime_domain_failure",
      dataSources: [
        {
          id: "1",
          type: "uptime_subscription",
          queryObj: {
            url: "https://example.com/a-very-long-path/that-will-not-fit-in-forty-cells",
            intervalSeconds: 60,
          },
        },
      ],
    });
    const parts = detectorDetailParts(uptime, { projectSlug: "marketing" });
    expect(parts[0]).toBe("marketing");
    expect(parts[1]).toContain("…");
    expect(parts[1]!.length).toBeLessThanOrEqual(40);
    // The largest whole unit, as `getDuration` does on the web: a 60-second
    // check reads "Every 1m", not "Every 60s".
    expect(parts[2]).toBe("Every 1m");
  });

  test("cron: project and schedule", () => {
    const cron = detector({
      type: "monitor_check_in_failure",
      dataSources: [
        {
          id: "1",
          type: "cron_monitor",
          queryObj: { id: "c1", config: { schedule: "0 9 * * *", schedule_type: "crontab" } },
        },
      ],
    });
    expect(detectorDetailParts(cron, { projectSlug: "billing" })).toEqual([
      "billing",
      "Every day at 09:00",
    ]);
  });

  test("mobile build: project, measurement and threshold type", () => {
    const preprod = detector({
      type: "preprod_size_analysis",
      config: { measurement: "download_size", thresholdType: "absolute" },
    });
    expect(detectorDetailParts(preprod, { projectSlug: "mobile" })).toEqual([
      "mobile",
      "download_size absolute",
    ]);
  });

  test("error: the project is the whole line", () => {
    expect(detectorDetailParts(detector({ type: "error" }), { projectSlug: "checkout" })).toEqual([
      "checkout",
    ]);
  });

  test("an unknown type still gets its project rather than nothing", () => {
    expect(
      detectorDetailParts(detector({ type: "something_new" }), { projectSlug: "checkout" }),
    ).toEqual(["checkout"]);
  });

  test("an unresolved project leaves the line to the type's own fields", () => {
    expect(detectorDetailParts(METRIC)).toEqual([
      "production",
      "p95(span.duration)",
      "transaction:/checkout",
      ">500ms high",
    ]);
  });
});
