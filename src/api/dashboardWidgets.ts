/**
 * Widget data — what a dashboard widget is actually showing.
 *
 * A dashboard tells you the shape of each widget (`displayType`), the dataset
 * it reads (`widgetType`), and the query behind it; the numbers come from a
 * second request per widget, through the same `events/` and `events-stats/`
 * endpoints the rest of the app uses (`widgetCard/widgetQueries.spec.tsx:288-330`).
 *
 * Fourteen display types exist upstream (`views/dashboards/types.tsx:40-55`)
 * and a terminal can honestly draw seven of them. `widgetRenderKind` is the
 * whole of that decision, kept as one total function so an unfamiliar display
 * type lands on the honest fallback rather than on a blank card.
 */

import type { SentryClient } from "~/api/client";
import type { DashboardWidget, WidgetDisplayType, WidgetQuery, WidgetType } from "~/api/dashboards";
import {
  queryDiscover,
  queryDiscoverTimeseries,
  rowNumber,
  rowString,
  type DiscoverDataset,
  type DiscoverRow,
  type TimeseriesBucket,
} from "~/api/discover";

// ---------------------------------------------------------------------------
// Display type → what the terminal draws
// ---------------------------------------------------------------------------

/**
 * How a widget is drawn here.
 *
 * - `number` — one big value, centred. The best-looking widget in a terminal.
 * - `series` — a block-glyph chart over time.
 * - `table` — rows and columns.
 * - `bars` — horizontal bars with labels, one per group.
 * - `unsupported` — title plus an honest note. Flame graphs, replay clips and
 *   node trees do not survive a character grid.
 */
export type WidgetRenderKind = "number" | "series" | "table" | "bars" | "unsupported";

/**
 * The renderable kind for a display type. Total: anything unrecognised —
 * including a display type Sentry adds tomorrow — is `unsupported`.
 */
export function widgetRenderKind(displayType: WidgetDisplayType): WidgetRenderKind {
  switch (displayType) {
    case "big_number":
      return "number";
    case "bar":
    case "area":
    case "line":
      return "series";
    case "table":
    case "top_n":
      return "table";
    case "categorical_bar":
      return "bars";
    // `details`, `server_tree`, `rage_and_dead_clicks`, `wheel`,
    // `agents_traces_table`, `text` and `heatmap` all need pixels, a pointer,
    // or both.
    default:
      return "unsupported";
  }
}

/**
 * The `dataset` a widget's queries run against.
 *
 * `null` for the widget types that don't go through `events/` at all: issue
 * widgets read the issues endpoint and release widgets the sessions one, and
 * neither is worth a second query path for one widget shape.
 */
export function widgetDataset(widgetType: WidgetType | null | undefined): DiscoverDataset | null {
  switch (widgetType) {
    // Absent means the legacy Discover widget, per the serializer's own
    // default (`serializers/models/dashboard.py:145-160`).
    case undefined:
    case null:
    case "discover":
      return "discover";
    case "error-events":
      return "errors";
    case "transaction-like":
      return "transactions";
    case "spans":
      return "spans";
    // `DiscoverDatasets.OURLOGS` — the dashboards config's name for logs.
    case "logs":
      return "ourlogs";
    case "tracemetrics":
      return "tracemetrics";
    case "preprod-app-size":
      return "preprodSize";
    // "issue" and the two metrics types.
    default:
      return null;
  }
}

/** Why a widget can't be drawn, in the words the card prints. */
export function unsupportedReason(widget: DashboardWidget): string {
  if (widgetRenderKind(widget.displayType) === "unsupported") {
    return `"${widget.displayType}" widgets are not renderable in the terminal.`;
  }
  return `"${widget.widgetType}" widgets are not read through the events API.`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type WidgetData =
  | { kind: "number"; value: number | undefined; formatted: string; label: string }
  | { kind: "series"; buckets: TimeseriesBucket[]; label: string }
  | { kind: "table"; headers: string[]; fields: string[]; rows: DiscoverRow[] }
  | { kind: "bars"; entries: ReadonlyArray<{ label: string; value: number }>; label: string };

/** `DEFAULT_TABLE_LIMIT` / `MAX_TABLE_LIMIT` — `views/dashboards/types.tsx:31-32`. */
export const DEFAULT_TABLE_ROWS = 5;
export const MAX_TABLE_ROWS = 10;

/**
 * Bars drawn for a categorical widget.
 *
 * The web's default is 20 (`types.tsx:34`), which is a card taller than most
 * terminals; the tail of a bar chart is also where it stops being readable.
 */
export const MAX_CATEGORICAL_BARS = 8;

export interface WidgetDataParams {
  org: string;
  widget: DashboardWidget;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  signal?: AbortSignal;
}

/**
 * Fetch one widget's data — exactly one request.
 *
 * Only the widget's **first** query is run. A widget with several is several
 * series on the web; here it is one, and the card says so rather than fanning
 * a dashboard's request count out by a factor nobody asked for.
 *
 * @returns The data, or `null` when the widget is one the terminal doesn't
 *   draw or the dataset isn't reachable through `events/`.
 */
export async function fetchWidgetData(
  client: SentryClient,
  { org, widget, statsPeriod, project, environment, signal }: WidgetDataParams,
): Promise<WidgetData | null> {
  const kind = widgetRenderKind(widget.displayType);
  const dataset = widgetDataset(widget.widgetType);
  const query = widget.queries[0];
  if (kind === "unsupported" || dataset === null || !query) return null;

  const common = {
    org,
    dataset,
    query: query.conditions,
    statsPeriod,
    project,
    environment,
    referrer: "sentry-tui.dashboards",
    signal,
  };

  switch (kind) {
    case "number": {
      const aggregate = bigNumberAggregate(query);
      const page = await queryDiscover(client, { ...common, fields: [aggregate], limit: 1 });
      const value = page.rows[0] ? rowNumber(page.rows[0], aggregate) : undefined;
      return { kind: "number", value, formatted: formatWidgetValue(value), label: aggregate };
    }

    case "series": {
      const yAxis = query.aggregates[0] ?? "count()";
      const buckets = await queryDiscoverTimeseries(client, { ...common, yAxis });
      return { kind: "series", buckets, label: yAxis };
    }

    case "table": {
      const fields = tableFields(query);
      const page = await queryDiscover(client, {
        ...common,
        fields,
        sort: query.orderby || undefined,
        limit: tableRowLimit(widget),
      });
      return { kind: "table", headers: tableHeaders(query, fields), fields, rows: page.rows };
    }

    case "bars": {
      const group = query.columns[0];
      const aggregate = query.aggregates[0] ?? "count()";
      const fields = group ? [group, aggregate] : [aggregate];
      const page = await queryDiscover(client, {
        ...common,
        fields,
        sort: query.orderby || `-${aggregate}`,
        limit: MAX_CATEGORICAL_BARS,
      });
      const entries = page.rows.map((row, index) => ({
        label: (group ? rowString(row, group) : undefined) ?? `#${index + 1}`,
        value: rowNumber(row, aggregate) ?? 0,
      }));
      return { kind: "bars", entries, label: aggregate };
    }
  }
}

/**
 * The aggregate a big-number widget shows.
 *
 * A widget with several picks one at build time (`selectedAggregate`), so the
 * card shows the number the author chose rather than the first one stored.
 */
export function bigNumberAggregate(query: WidgetQuery): string {
  const index = query.selectedAggregate ?? 0;
  return query.aggregates[index] ?? query.aggregates[0] ?? "count()";
}

/**
 * Columns a table widget requests, in the order it draws them.
 *
 * `fields` is what carries that order; `columns` plus `aggregates` is the
 * fallback for a query saved before the split.
 */
export function tableFields(query: WidgetQuery): string[] {
  const fields = query.fields?.filter((field) => field.length > 0) ?? [];
  if (fields.length > 0) return fields;
  const combined = [...query.columns, ...query.aggregates].filter((field) => field.length > 0);
  return combined.length > 0 ? combined : ["count()"];
}

/** Header text per column: the author's alias where there is one. */
export function tableHeaders(query: WidgetQuery, fields: readonly string[]): string[] {
  return fields.map((field, index) => query.fieldAliases?.[index] || field);
}

/** Rows a table widget asks for, within the limits the web itself imposes. */
export function tableRowLimit(widget: DashboardWidget): number {
  const limit = widget.limit ?? DEFAULT_TABLE_ROWS;
  return Math.max(1, Math.min(limit, MAX_TABLE_ROWS));
}

/**
 * A widget value as the card prints it.
 *
 * The endpoint returns no units without a `meta` block we don't request, so
 * this stays deliberately unit-free: big counts are abbreviated, fractions keep
 * two decimals, and nothing claims to be milliseconds when it might be bytes.
 */
export function formatWidgetValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (!Number.isInteger(value)) {
    return Math.abs(value) >= 1000 ? abbreviate(value) : value.toFixed(2);
  }
  return Math.abs(value) >= 10_000 ? abbreviate(value) : String(value);
}

function abbreviate(value: number): string {
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);
  if (n >= 1_000_000_000) return `${sign}${trim(n / 1_000_000_000)}b`;
  if (n >= 1_000_000) return `${sign}${trim(n / 1_000_000)}m`;
  return `${sign}${trim(n / 1000)}k`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
