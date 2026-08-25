import { expect, test } from "bun:test";

import type { DashboardDetails, DashboardListItem } from "~/api/dashboards";
import { withPrebuiltDetails, withPrebuiltListMetadata } from "~/core/prebuiltDashboards";

const rows: DashboardListItem[] = [
  { id: "6", title: "Web Vitals", widgetDisplay: [], prebuiltId: 6 },
  { id: "12", title: "Backend Overview", widgetDisplay: [], prebuiltId: 12 },
  { id: "16", title: "AI Agents Overview", widgetDisplay: [], prebuiltId: 16 },
];

test("default-starred prebuilt list rows use the widget definitions Web bundles", () => {
  const hydrated = rows.map(withPrebuiltListMetadata);

  expect(hydrated.map((row) => row.widgetDisplay.length)).toEqual([8, 7, 7]);
  expect(hydrated[0]?.widgetDisplay[0]).toBe("wheel");
  expect(hydrated[2]?.widgetDisplay.at(-1)).toBe("agents_traces_table");
  expect(hydrated.every((row) => Boolean(row.description))).toBe(true);
});

test("prebuilt detail shells gain ordered widget definitions and queries", () => {
  const shell: DashboardDetails = {
    id: "16",
    title: "AI Agents Overview",
    widgets: [],
    projects: [],
    prebuiltId: 16,
  };

  const hydrated = withPrebuiltDetails(shell);

  expect(hydrated.widgets.map((widget) => widget.title)).toEqual([
    "Agent Runs",
    "Estimated Cost",
    "Duration",
    "LLM Calls by Model",
    "Tokens Used",
    "Tool Calls",
    "Traces",
  ]);
  expect(hydrated.widgets[0]?.queries[0]?.conditions).toBe("gen_ai.operation.type:agent");
});

test("server widgets win, and unknown prebuilt IDs stay untouched", () => {
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
  const unknownRow: DashboardListItem = {
    id: "999",
    title: "Future dashboard",
    widgetDisplay: [],
    prebuiltId: 999,
  };

  expect(withPrebuiltDetails(serverDetail)).toBe(serverDetail);
  expect(withPrebuiltListMetadata(unknownRow)).toBe(unknownRow);
});
