/**
 * Widget definitions Sentry Web bundles for the default-starred dashboards.
 *
 * The API stores only a prebuilt dashboard's identity and user state; widgets
 * live in `views/dashboards/utils/prebuiltConfigs/` in Sentry Web. Keep the
 * three server-default favorites here so list counts and detail rendering use
 * one definition. Unknown and non-default prebuilts degrade honestly until
 * they are added deliberately.
 */

import type {
  DashboardDetails,
  DashboardListItem,
  DashboardWidget,
  WidgetQuery,
} from "~/api/dashboards";

interface PrebuiltDashboardDefinition {
  description: string;
  widgets: DashboardWidget[];
}

const SPAN_DURATION = "span.duration";
const WEB_VITALS_FILTER =
  'span.op:[ui.interaction.click,ui.interaction.hover,ui.interaction.drag,ui.interaction.press,ui.webvital.cls,ui.webvital.lcp,pageload,""]';

/** Build the query fields every dashboard widget carries. */
function query({
  name = "",
  conditions = "",
  columns = [],
  aggregates = [],
  orderby = "",
  fields,
  fieldAliases,
}: Partial<WidgetQuery> = {}): WidgetQuery {
  return { name, conditions, columns, aggregates, orderby, fields, fieldAliases };
}

const AI_AGENTS_OVERVIEW: PrebuiltDashboardDefinition = {
  description: "Monitor AI agent workflows, model costs, token usage, and tool calls.",
  widgets: [
    {
      id: "ai-agents-overview-agent-runs",
      title: "Agent Runs",
      description: "Number of agent runs captured over time.",
      displayType: "bar",
      widgetType: "spans",
      interval: "1h",
      queries: [
        query({
          name: "Count",
          conditions: "gen_ai.operation.type:agent",
          fields: [`count(${SPAN_DURATION})`],
          aggregates: [`count(${SPAN_DURATION})`],
          fieldAliases: ["Count"],
          orderby: `-count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 0, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "ai-agents-overview-estimated-cost",
      title: "Estimated Cost",
      description: "Estimated cost of LLM calls with token and model data.",
      displayType: "bar",
      widgetType: "spans",
      interval: "1h",
      queries: [
        query({
          name: "Cost",
          conditions: "gen_ai.operation.type:ai_client",
          fields: ["sum(gen_ai.cost.total_tokens)"],
          aggregates: ["sum(gen_ai.cost.total_tokens)"],
          fieldAliases: ["Estimated Cost"],
          orderby: "-sum(gen_ai.cost.total_tokens)",
        }),
      ],
      layout: { x: 2, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "ai-agents-overview-duration",
      title: "Duration",
      description: "Average and p95 duration for agent runs and LLM calls.",
      displayType: "line",
      widgetType: "spans",
      interval: "1h",
      queries: [
        query({
          conditions: "gen_ai.operation.type:[agent, ai_client]",
          fields: [`avg(${SPAN_DURATION})`, `p95(${SPAN_DURATION})`],
          aggregates: [`avg(${SPAN_DURATION})`, `p95(${SPAN_DURATION})`],
          fieldAliases: ["Avg", "P95"],
          orderby: `-avg(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 4, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "ai-agents-overview-llm-calls-by-model",
      title: "LLM Calls by Model",
      description: "Number of LLM calls grouped by response model.",
      displayType: "bar",
      widgetType: "spans",
      interval: "1h",
      limit: 3,
      queries: [
        query({
          conditions: "gen_ai.operation.type:ai_client",
          fields: ["gen_ai.response.model", `count(${SPAN_DURATION})`],
          columns: ["gen_ai.response.model"],
          aggregates: [`count(${SPAN_DURATION})`],
          fieldAliases: ["Model", "Calls"],
          orderby: `-count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 0, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "ai-agents-overview-tokens-used",
      title: "Tokens Used",
      description: "Total tokens used by LLM calls, grouped by response model.",
      displayType: "bar",
      widgetType: "spans",
      interval: "1h",
      limit: 3,
      queries: [
        query({
          conditions: "gen_ai.operation.type:ai_client",
          fields: ["gen_ai.response.model", "sum(gen_ai.usage.total_tokens)"],
          columns: ["gen_ai.response.model"],
          aggregates: ["sum(gen_ai.usage.total_tokens)"],
          fieldAliases: ["Model", "Total Tokens"],
          orderby: "-sum(gen_ai.usage.total_tokens)",
        }),
      ],
      layout: { x: 2, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "ai-agents-overview-tool-calls",
      title: "Tool Calls",
      description: "Tool call volume grouped by tool name.",
      displayType: "bar",
      widgetType: "spans",
      interval: "1h",
      limit: 3,
      queries: [
        query({
          conditions: "gen_ai.operation.type:tool",
          fields: ["gen_ai.tool.name", `count(${SPAN_DURATION})`],
          columns: ["gen_ai.tool.name"],
          aggregates: [`count(${SPAN_DURATION})`],
          fieldAliases: ["Tool", "Calls"],
          orderby: `-count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 4, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "ai-agents-traces-table",
      title: "Traces",
      description: "Agent traces with duration, token, cost, and tool usage.",
      displayType: "agents_traces_table",
      interval: "1h",
      limit: 10,
      queries: [query()],
      layout: { x: 0, y: 6, w: 6, h: 4, minH: 2 },
    },
  ],
};

const WEB_VITAL_SCORE_FIELDS = [
  "performance_score(measurements.score.lcp)",
  "performance_score(measurements.score.fcp)",
  "performance_score(measurements.score.inp)",
  "performance_score(measurements.score.cls)",
  "performance_score(measurements.score.ttfb)",
];

const WEB_VITALS: PrebuiltDashboardDefinition = {
  description: "Track real-user Web Vitals, ranked by improvement opportunity.",
  widgets: [
    {
      id: "score-breakdown-wheel",
      title: "Performance Score",
      description: "Tracks the overall performance rating of the pages in your selected project.",
      displayType: "wheel",
      widgetType: "spans",
      interval: "5m",
      limit: 1,
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: [
            ...WEB_VITAL_SCORE_FIELDS,
            "performance_score(measurements.score.total)",
            "count_scores(measurements.score.total)",
            "count_scores(measurements.score.lcp)",
            "count_scores(measurements.score.fcp)",
            "count_scores(measurements.score.inp)",
            "count_scores(measurements.score.cls)",
            "count_scores(measurements.score.ttfb)",
          ],
          columns: [
            ...WEB_VITAL_SCORE_FIELDS,
            "performance_score(measurements.score.total)",
            "count_scores(measurements.score.total)",
            "count_scores(measurements.score.lcp)",
            "count_scores(measurements.score.fcp)",
            "count_scores(measurements.score.inp)",
            "count_scores(measurements.score.cls)",
            "count_scores(measurements.score.ttfb)",
          ],
        }),
      ],
      layout: { x: 0, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "score-breakdown-chart",
      title: "Score Breakdown",
      description:
        "Each Web Vital score contributes a different amount to the total score. Refer to the Performance Score wheel for total contribution.",
      displayType: "area",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: WEB_VITAL_SCORE_FIELDS,
          aggregates: WEB_VITAL_SCORE_FIELDS,
        }),
      ],
      layout: { x: 2, y: 0, w: 4, h: 2, minH: 2 },
    },
    {
      id: "lcp-p75-meter",
      title: "P75 Largest Contentful Paint",
      displayType: "big_number",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: ["p75(browser.web_vital.lcp.value)"],
          aggregates: ["p75(browser.web_vital.lcp.value)"],
        }),
      ],
      layout: { x: 0, y: 2, w: 1, h: 1, minH: 1 },
    },
    {
      id: "inp-p75-meter",
      title: "P75 Interaction to Next Paint",
      displayType: "big_number",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: ["p75(browser.web_vital.inp.value)"],
          aggregates: ["p75(browser.web_vital.inp.value)"],
        }),
      ],
      layout: { x: 1, y: 2, w: 1, h: 1, minH: 1 },
    },
    {
      id: "issues-table",
      title: "Web Vital Issues",
      displayType: "table",
      widgetType: "issue",
      interval: "5m",
      queries: [
        query({
          conditions:
            "issue.type:[web_vitals,performance_render_blocking_asset_span,performance_uncompressed_assets,performance_http_overhead,performance_consecutive_http,performance_n_plus_one_api_calls,performance_large_http_payload,performance_p95_endpoint_regression]",
          fields: ["issue", "assignee", "title"],
          columns: ["issue", "assignee", "title"],
          orderby: "date",
        }),
      ],
      layout: { x: 2, y: 2, w: 4, h: 2, minH: 2 },
    },
    {
      id: "cls-p75-meter",
      title: "P75 Cumulative Layout Shift",
      displayType: "big_number",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: ["p75(browser.web_vital.cls.value)"],
          aggregates: ["p75(browser.web_vital.cls.value)"],
        }),
      ],
      layout: { x: 0, y: 3, w: 1, h: 1, minH: 1 },
    },
    {
      id: "ttfb-p75-meter",
      title: "P75 Time to First Byte",
      displayType: "big_number",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: ["p75(browser.web_vital.ttfb.value)"],
          aggregates: ["p75(browser.web_vital.ttfb.value)"],
        }),
      ],
      layout: { x: 1, y: 3, w: 1, h: 1, minH: 1 },
    },
    {
      id: "pages-table",
      title: "Pages",
      displayType: "table",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions: WEB_VITALS_FILTER,
          fields: [
            "transaction",
            "project",
            "count()",
            "p75(browser.web_vital.lcp.value)",
            "p75(browser.web_vital.fcp.value)",
            "p75(browser.web_vital.cls.value)",
            "p75(browser.web_vital.ttfb.value)",
            "p75(browser.web_vital.inp.value)",
            "performance_score(measurements.score.total)",
            "opportunity_score(measurements.score.total)",
          ],
          columns: [
            "transaction",
            "project",
            "count()",
            "p75(browser.web_vital.lcp.value)",
            "p75(browser.web_vital.fcp.value)",
            "p75(browser.web_vital.cls.value)",
            "p75(browser.web_vital.ttfb.value)",
            "p75(browser.web_vital.inp.value)",
            "performance_score(measurements.score.total)",
            "opportunity_score(measurements.score.total)",
          ],
          fieldAliases: [
            "Pages",
            "Project",
            "Pageloads",
            "LCP",
            "FCP",
            "CLS",
            "TTFB",
            "INP",
            "Perf Score",
            "Opportunity",
          ],
          orderby: "-opportunity_score(measurements.score.total)",
        }),
      ],
      layout: { x: 0, y: 4, w: 6, h: 6, minH: 2 },
    },
  ],
};

const BACKEND_TABLE_FIELDS = [
  "is_starred_transaction",
  "request.method",
  "transaction",
  "span.op",
  "project",
  "epm()",
  `p50(${SPAN_DURATION})`,
  `p95(${SPAN_DURATION})`,
  `equation|failure_count() / count(${SPAN_DURATION})`,
  "count_unique(user)",
  `sum(${SPAN_DURATION})`,
];

const BACKEND_OVERVIEW: PrebuiltDashboardDefinition = {
  description: "Monitor backend services and dependencies, including caches and queues.",
  widgets: [
    {
      id: "requests-widget",
      title: "Requests",
      displayType: "line",
      widgetType: "spans",
      interval: "1h",
      limit: 5,
      queries: [
        query({
          name: "Requests",
          conditions: "span.op:http.server",
          fields: [
            `count(${SPAN_DURATION})`,
            `equation|(count_if(trace.status,equals,internal_error) + count_if(trace.status,equals,error)) / count(${SPAN_DURATION})`,
          ],
          aggregates: [
            `count(${SPAN_DURATION})`,
            `equation|(count_if(trace.status,equals,internal_error) + count_if(trace.status,equals,error)) / count(${SPAN_DURATION})`,
          ],
          orderby: `count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 0, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "api-latency-widget",
      title: "API Latency",
      displayType: "line",
      widgetType: "spans",
      interval: "1h",
      queries: [
        query({
          conditions: "span.op:http.server",
          fields: [`avg(${SPAN_DURATION})`, `p95(${SPAN_DURATION})`],
          aggregates: [`avg(${SPAN_DURATION})`, `p95(${SPAN_DURATION})`],
          orderby: `avg(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 2, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "issue-counts",
      title: "Issue Counts",
      displayType: "bar",
      widgetType: "issue",
      interval: "5m",
      queries: [
        query({
          fields: ["count(new_issues)", "count(resolved_issues)"],
          aggregates: ["count(new_issues)", "count(resolved_issues)"],
        }),
      ],
      layout: { x: 4, y: 0, w: 2, h: 2, minH: 2 },
    },
    {
      id: "jobs-chart",
      title: "Jobs",
      displayType: "line",
      widgetType: "spans",
      interval: "1h",
      limit: 3,
      queries: [
        query({
          conditions: "span.op:queue.process",
          fields: [
            `count(${SPAN_DURATION})`,
            `equation|(count_if(trace.status,equals,internal_error) + count_if(trace.status,equals,error)) / count(${SPAN_DURATION})`,
          ],
          aggregates: [
            `count(${SPAN_DURATION})`,
            `equation|(count_if(trace.status,equals,internal_error) + count_if(trace.status,equals,error)) / count(${SPAN_DURATION})`,
          ],
          orderby: `count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 0, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "queries-by-time-spent-chart",
      title: "Queries by Time Spent",
      displayType: "line",
      widgetType: "spans",
      interval: "5m",
      limit: 3,
      queries: [
        query({
          conditions: "span.category:db has:sentry.normalized_description",
          fields: ["sentry.normalized_description", `p75(${SPAN_DURATION})`],
          columns: ["sentry.normalized_description"],
          aggregates: [`p75(${SPAN_DURATION})`],
          fieldAliases: [""],
          orderby: `-sum(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 2, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "cache-miss-rates-chart",
      title: "Cache Miss Rates",
      displayType: "line",
      widgetType: "spans",
      interval: "1h",
      limit: 3,
      queries: [
        query({
          conditions: "span.op:[cache.get,cache.get_item]",
          fields: [`equation|count_if(cache.hit,equals,false) / count(${SPAN_DURATION})`],
          columns: ["transaction"],
          aggregates: [`equation|count_if(cache.hit,equals,false) / count(${SPAN_DURATION})`],
          fieldAliases: [""],
          orderby: `-equation|count_if(cache.hit,equals,false) / count(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 4, y: 2, w: 2, h: 3, minH: 3 },
    },
    {
      id: "backend-overview-transactions-table",
      title: "Transactions",
      displayType: "table",
      widgetType: "spans",
      interval: "5m",
      queries: [
        query({
          conditions:
            "((!span.op:[pageload,navigation,ui.render,interaction,ui.action.swipe,ui.action.scroll,ui.action.click,ui.action,ui.load,app.lifecycle,ui.interaction,ui.interaction.click,ui.interaction.hover,ui.interaction.drag,ui.interaction.press,ui.webvital.cls,ui.webvital.lcp,ui.webvital.fcp]) OR span.op:[http.server]) is_transaction:true",
          fields: BACKEND_TABLE_FIELDS,
          columns: [
            "is_starred_transaction",
            "request.method",
            "transaction",
            "span.op",
            "project",
          ],
          aggregates: [
            "epm()",
            `p50(${SPAN_DURATION})`,
            `p95(${SPAN_DURATION})`,
            `equation|failure_count() / count(${SPAN_DURATION})`,
            "count_unique(user)",
            `sum(${SPAN_DURATION})`,
          ],
          fieldAliases: [
            "",
            "HTTP Method",
            "Transaction",
            "Operation",
            "Project",
            "TPM",
            "P50",
            "P95",
            "Failure rate",
            "Users",
            "Time Spent",
          ],
          orderby: `-sum(${SPAN_DURATION})`,
        }),
      ],
      layout: { x: 0, y: 7, w: 6, h: 6, minH: 2 },
    },
  ],
};

const PREBUILT_DASHBOARDS: Readonly<Record<number, PrebuiltDashboardDefinition>> = {
  // PrebuiltDashboardId.WEB_VITALS
  6: WEB_VITALS,
  // PrebuiltDashboardId.BACKEND_OVERVIEW
  12: BACKEND_OVERVIEW,
  // PrebuiltDashboardId.AI_AGENTS_OVERVIEW
  16: AI_AGENTS_OVERVIEW,
};

/** Hydrate list metadata the API deliberately omits for a known prebuilt. */
export function withPrebuiltListMetadata(dashboard: DashboardListItem): DashboardListItem {
  if (dashboard.prebuiltId == null) return dashboard;
  const definition = PREBUILT_DASHBOARDS[dashboard.prebuiltId];
  if (!definition) return dashboard;

  return {
    ...dashboard,
    description: dashboard.description ?? definition.description,
    widgetDisplay:
      dashboard.widgetDisplay.length > 0
        ? dashboard.widgetDisplay
        : definition.widgets.map((widget) => widget.displayType),
  };
}

/** Hydrate widgets the API deliberately omits from a known prebuilt detail. */
export function withPrebuiltDetails(dashboard: DashboardDetails): DashboardDetails {
  if (dashboard.widgets.length > 0 || dashboard.prebuiltId == null) return dashboard;
  const definition = PREBUILT_DASHBOARDS[dashboard.prebuiltId];
  return definition ? { ...dashboard, widgets: structuredClone(definition.widgets) } : dashboard;
}
