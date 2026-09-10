import { describe, expect, test } from "bun:test";

import {
  embedNumber,
  embedText,
  embedTexts,
  inlineSeerEmbed,
  isSeerEmbed,
  readEmbedFilters,
  readQueryEmbed,
  resolveMetricsEmbed,
  SEER_EMBED_LEVELS,
  seerEmbedLevel,
} from "~/core/seerEmbeds";

/**
 * The embeds the web app registers, as of the schema this table mirrors.
 *
 * Spelled out rather than derived so that adding a renderer without adding its
 * levels — or the reverse — fails here instead of silently dropping the tag at
 * runtime.
 */
const REGISTERED = [
  "agentWriteApproval",
  "alert",
  "autofix",
  "autofixRef",
  "chart",
  "dashboard",
  "docs",
  "dsn",
  "errorsQuery",
  "issue",
  "issues",
  "issuesQuery",
  "logsQuery",
  "metricsQuery",
  "monitor",
  "profile",
  "release",
  "replay",
  "replaysQuery",
  "savedIssueView",
  "savedQuery",
  "spansQuery",
  "timestamp",
  "trace",
  "user",
];

test("every embed the web app registers has a level", () => {
  expect(Object.keys(SEER_EMBED_LEVELS).sort()).toEqual(REGISTERED);
});

describe("level", () => {
  test("a name allowing both levels follows its position in the source", () => {
    expect(seerEmbedLevel("issue", true)).toBe("block");
    expect(seerEmbedLevel("issue", false)).toBe("inline");
  });

  test("a name allowing one level keeps it wherever it appears", () => {
    // A stray timestamp on its own line is still a word, not a card.
    expect(seerEmbedLevel("timestamp", true)).toBe("inline");
    expect(seerEmbedLevel("timestamp", false)).toBe("inline");
    // An `issues` table mid-sentence still has to be a table.
    expect(seerEmbedLevel("issues", false)).toBe("block");
  });

  test("an unregistered name has no level", () => {
    expect(seerEmbedLevel("somethingNew", true)).toBeNull();
    expect(isSeerEmbed("somethingNew")).toBe(false);
  });
});

describe("reading agent-authored payloads", () => {
  test("ids arriving as bare numbers are still ids", () => {
    expect(embedText(4521)).toBe("4521");
    expect(embedTexts(["a", 2, null, ""])).toEqual(["a", "2"]);
    expect(embedNumber("12")).toBe(12);
  });

  test("empty and non-scalar fields read as absent", () => {
    expect(embedText("")).toBeUndefined();
    expect(embedText(null)).toBeUndefined();
    expect(embedText(Number.NaN)).toBeUndefined();
    expect(embedTexts("not a list")).toEqual([]);
  });

  test("a stats period the screens cannot use is dropped, not forwarded", () => {
    expect(readEmbedFilters({ statsPeriod: "24h" }).statsPeriod).toBe("24h");
    expect(readEmbedFilters({ statsPeriod: "last tuesday" }).statsPeriod).toBeUndefined();
  });

  test("an unrecognized mode falls back to samples rather than rendering nothing", () => {
    expect(readQueryEmbed({ mode: "aggregate" }).mode).toBe("aggregate");
    expect(readQueryEmbed({ mode: "nonsense" }).mode).toBe("samples");
    expect(readQueryEmbed({}).mode).toBe("samples");
  });

  test("query fields normalize to the shape the preview cards read", () => {
    expect(
      readQueryEmbed({
        query: "span.op:http.client",
        mode: "aggregate",
        groupBy: ["span.op"],
        yAxes: ["p95(span.duration)"],
        statsPeriod: "7d",
        projects: [1, "2"],
        environments: ["prod"],
      }),
    ).toEqual({
      query: "span.op:http.client",
      mode: "aggregate",
      groupBy: ["span.op"],
      yAxes: ["p95(span.duration)"],
      fields: [],
      sort: undefined,
      title: undefined,
      filters: {
        projects: ["1", "2"],
        environments: ["prod"],
        statsPeriod: "7d",
        start: undefined,
        end: undefined,
      },
    });
  });
});

/**
 * Explore identifies a metric in two different places depending on the mode,
 * and picking the wrong one silently answers with another metric's numbers —
 * so these assert the exact strings `metricsQueryUtils.ts` builds.
 */
describe("metrics", () => {
  const metric = { name: "checkout.latency", type: "distribution", unit: "millisecond" };

  test("aggregate mode qualifies the aggregate and leaves the search alone", () => {
    const data = { ...metric, mode: "aggregate", query: "env:prod", yAxes: ["p95(value)"] };
    expect(resolveMetricsEmbed(data, readQueryEmbed(data))).toEqual({
      query: "env:prod",
      yAxes: ["p95(value,checkout.latency,distribution,millisecond)"],
    });
  });

  test("an absent aggregate falls back to the one the Metrics UI opens with", () => {
    const gauge = { name: "queue.depth", type: "gauge", mode: "aggregate" };
    expect(resolveMetricsEmbed(gauge, readQueryEmbed(gauge)).yAxes).toEqual([
      "avg(value,queue.depth,gauge,none)",
    ]);
    const counter = { name: "checkout.count", type: "counter", mode: "aggregate" };
    expect(resolveMetricsEmbed(counter, readQueryEmbed(counter)).yAxes).toEqual([
      "sum(value,checkout.count,counter,none)",
    ]);
  });

  test("samples mode moves the metric's identity into the search string", () => {
    const data = { ...metric, mode: "samples", query: "env:prod" };
    expect(resolveMetricsEmbed(data, readQueryEmbed(data)).query).toBe(
      "env:prod (metric.name:checkout.latency metric.type:distribution metric.unit:millisecond)",
    );
  });

  test("a unitless metric matches rows that never carried the attribute", () => {
    const data = { name: "checkout.count", type: "counter", unit: "-", mode: "samples" };
    expect(resolveMetricsEmbed(data, readQueryEmbed(data)).query).toBe(
      "(metric.name:checkout.count metric.type:counter (!has:metric.unit OR metric.unit:none))",
    );
  });

  test("a payload with no metric is passed through untouched", () => {
    const data = { mode: "samples", query: "env:prod" };
    expect(resolveMetricsEmbed(data, readQueryEmbed(data))).toEqual({
      query: "env:prod",
      yAxes: [],
    });
  });
});

describe("inline text", () => {
  test("references read as their own name, not their id, when they have one", () => {
    expect(inlineSeerEmbed("monitor", { id: "9931", name: "nightly-sync" })).toBe(
      "**nightly-sync**",
    );
    expect(inlineSeerEmbed("monitor", { id: "9931" })).toBe("**Monitor 9931**");
  });

  test("a reference missing its id still reads as a sentence", () => {
    expect(inlineSeerEmbed("trace", {})).toBe("**Trace**");
    expect(inlineSeerEmbed("profile", {})).toBe("**Profile**");
  });

  test("opaque ids are shortened to the part a person can recognise", () => {
    expect(inlineSeerEmbed("trace", { traceId: "a1b2c3d4e5f678901234567890abcdef" })).toBe(
      "**Trace a1b2c3d4**",
    );
  });

  test("a saved query names its dataset", () => {
    expect(inlineSeerEmbed("savedQuery", { id: "312", dataset: "spans", name: "Slow spans" })).toBe(
      "**Slow spans** (spans)",
    );
  });

  test("docs become a Markdown link so the renderer below can style it", () => {
    expect(
      inlineSeerEmbed("docs", { href: "https://docs.sentry.io/product/issues/", title: "Issues" }),
    ).toBe("[Issues](https://docs.sentry.io/product/issues/)");
  });

  test("a query embed falls back from title, to search, to the noun", () => {
    expect(inlineSeerEmbed("spansQuery", { title: "Slow spans", query: "x" })).toBe(
      "**Slow spans**",
    );
    expect(inlineSeerEmbed("spansQuery", { query: "span.op:db" })).toBe("**span.op:db**");
    expect(inlineSeerEmbed("spansQuery", {})).toBe("**All spans**");
  });

  test("an alert names its kind when it has no name", () => {
    expect(inlineSeerEmbed("alert", { id: "4521", kind: "metric" })).toBe("**metric alert 4521**");
  });

  test("relative timestamps render without a live timer", () => {
    const value = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(inlineSeerEmbed("timestamp", { value, format: "relative" })).toBe("2 days ago");
  });

  /**
   * The two embeds that are only ever a value. A timestamp with no time and a
   * doc link with neither title nor href have nothing to name, so they
   * collapse rather than leaving a placeholder in the middle of a sentence.
   */
  const VALUE_ONLY = new Set(["timestamp", "docs"]);

  test("every embed that names a thing still names it on an empty payload", () => {
    for (const name of REGISTERED) {
      if (VALUE_ONLY.has(name)) continue;
      expect([name, inlineSeerEmbed(name, {}).length > 0]).toEqual([name, true]);
    }
  });

  test("a value-only embed with no value renders nothing", () => {
    expect(inlineSeerEmbed("timestamp", {})).toBe("");
    expect(inlineSeerEmbed("docs", {})).toBe("");
  });
});
