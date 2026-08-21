import { describe, expect, test } from "bun:test";

import { chartInterval, statsPeriodMinutes } from "~/lib/interval";

describe("statsPeriodMinutes", () => {
  test("reads every unit the API accepts", () => {
    expect(statsPeriodMinutes("90s")).toBe(1.5);
    expect(statsPeriodMinutes("15m")).toBe(15);
    expect(statsPeriodMinutes("1h")).toBe(60);
    expect(statsPeriodMinutes("14d")).toBe(20_160);
    expect(statsPeriodMinutes("2w")).toBe(20_160);
  });

  test("treats a bare number as seconds, as the backend parser does", () => {
    expect(statsPeriodMinutes("120")).toBe(2);
  });

  test("returns nothing for a string that isn't a period", () => {
    expect(statsPeriodMinutes(undefined)).toBeUndefined();
    expect(statsPeriodMinutes("")).toBeUndefined();
    expect(statsPeriodMinutes("last week")).toBeUndefined();
    expect(statsPeriodMinutes("-1h")).toBeUndefined();
  });
});

describe("chartInterval", () => {
  test("matches the web's minimum-interval ladder at each threshold", () => {
    // `MINIMUM_INTERVAL`, app/utils/useChartInterval.tsx:176.
    expect(chartInterval("1m")).toBe("1m");
    expect(chartInterval("6h")).toBe("1m");
    expect(chartInterval("12h")).toBe("5m");
    expect(chartInterval("48h")).toBe("10m");
    expect(chartInterval("4d")).toBe("30m");
    expect(chartInterval("14d")).toBe("1h");
    expect(chartInterval("30d")).toBe("3h");
  });

  test("covers every period the filter bar offers", () => {
    expect(chartInterval("1h")).toBe("1m");
    expect(chartInterval("24h")).toBe("5m");
    expect(chartInterval("7d")).toBe("30m");
    expect(chartInterval("14d")).toBe("1h");
    expect(chartInterval("30d")).toBe("3h");
    expect(chartInterval("90d")).toBe("3h");
  });

  test("gives every offered period enough buckets to fill a chart", () => {
    // The bug this ladder fixes: an hour at the endpoint's own default is four
    // buckets. Nothing the filter bar offers may drop near that again.
    const minutes: Record<string, number> = { m: 1, h: 60, d: 1440 };
    for (const period of ["1h", "24h", "7d", "14d", "30d", "90d"]) {
      const interval = chartInterval(period)!;
      const width = Number(interval.slice(0, -1)) * minutes[interval.slice(-1)]!;
      const buckets = statsPeriodMinutes(period)! / width;
      expect(buckets).toBeGreaterThanOrEqual(60);
      // The web picks this ladder to stay under ~1000 points a series.
      expect(buckets).toBeLessThanOrEqual(1000);
    }
  });

  test("leaves the param off when the period can't be read", () => {
    expect(chartInterval(undefined)).toBeUndefined();
    expect(chartInterval("not-a-period")).toBeUndefined();
  });
});
