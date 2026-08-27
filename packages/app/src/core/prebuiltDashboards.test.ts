import { expect, test } from "bun:test";

import type { DashboardDetails, DashboardListItem } from "~/api/dashboards";
import { withPrebuiltDetails, withPrebuiltListMetadata } from "~/core/prebuiltDashboards";

const PREBUILTS = [
  [1, "Frontend Session Health", 7],
  [2, "Queries", 3],
  [3, "Query Details", 7],
  [4, "Outbound API Requests", 4],
  [5, "Domain Details", 11],
  [6, "Web Vitals", 8],
  [7, "Web Vitals Page Summary", 12],
  [8, "Mobile Vitals", 12],
  [9, "Mobile Vitals App Starts", 10],
  [10, "Mobile Vitals Screen Loads", 9],
  [11, "Mobile Vitals Screen Rendering", 1],
  [12, "Backend Overview", 7],
  [13, "Mobile Session Health", 9],
  [14, "Frontend Overview", 7],
  [15, "Next.js Overview", 9],
  [16, "AI Agents Overview", 7],
  [17, "AI Agents Model Details", 4],
  [18, "AI Agents Tool Details", 3],
  [19, "MCP Overview", 7],
  [20, "MCP Tool Details", 4],
  [21, "MCP Resource Details", 4],
  [22, "MCP Prompt Details", 4],
  [23, "Laravel Overview", 9],
  [24, "Frontend Assets", 3],
  [25, "Frontend Assets Summary", 11],
  [26, "Queues", 3],
  [27, "Queue Summary", 10],
  [28, "Caches", 3],
  [29, "Node.js Runtime Metrics", 6],
] as const;

test("every prebuilt list shell uses the widget definitions Web bundles", () => {
  const shells: DashboardListItem[] = PREBUILTS.map(([id, title]) => ({
    id: String(id),
    title,
    widgetDisplay: [],
    prebuiltId: id,
  }));
  const hydrated = shells.map(withPrebuiltListMetadata);

  expect(hydrated.map((row) => [row.prebuiltId, row.title, row.widgetDisplay.length])).toEqual(
    PREBUILTS.map((prebuilt) => [...prebuilt]),
  );
  expect(hydrated[0]?.description).toBe("Monitor browser session health by user and session.");
  expect(hydrated[5]?.widgetDisplay[0]).toBe("wheel");
  expect(hydrated[15]?.widgetDisplay.at(-1)).toBe("agents_traces_table");
});

test("every prebuilt detail shell gains its ordered widget definitions", () => {
  const hydrated = PREBUILTS.map(([id, title]) =>
    withPrebuiltDetails({
      id: String(id),
      title,
      widgets: [],
      projects: [],
      prebuiltId: id,
    }),
  );

  expect(hydrated.map((dashboard) => dashboard.widgets.length)).toEqual(
    PREBUILTS.map(([, , count]) => count),
  );
  expect(hydrated[15]?.widgets.map((widget) => widget.title)).toEqual([
    "Agent Runs",
    "Estimated Cost",
    "Duration",
    "LLM Calls by Model",
    "Tokens Used",
    "Tool Calls",
    "Traces",
  ]);
  expect(hydrated[15]?.widgets[0]?.queries[0]?.conditions).toBe("gen_ai.operation.type:agent");
});

test("server metadata and widgets win, and unknown prebuilt IDs stay untouched", () => {
  const customWidget = {
    id: "server-widget",
    title: "From the server",
    displayType: "line" as const,
    queries: [{ name: "", conditions: "", columns: [], aggregates: ["count()"], orderby: "" }],
  };
  const serverDetail: DashboardDetails = {
    id: "16",
    title: "AI Agents Overview",
    widgets: [customWidget],
    prebuiltId: 16,
  };
  const serverRow: DashboardListItem = {
    id: "16",
    title: "AI Agents Overview",
    description: "From the server",
    widgetDisplay: ["line"],
    prebuiltId: 16,
  };
  const unknownRow: DashboardListItem = {
    id: "999",
    title: "Future dashboard",
    widgetDisplay: [],
    prebuiltId: 999,
  };

  expect(withPrebuiltDetails(serverDetail)).toBe(serverDetail);
  expect(withPrebuiltListMetadata(serverRow)).toEqual(serverRow);
  expect(withPrebuiltListMetadata(unknownRow)).toBe(unknownRow);
});
