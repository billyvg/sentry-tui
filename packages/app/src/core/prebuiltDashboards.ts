/**
 * Widget definitions bundled by Sentry Web for its prebuilt dashboards.
 *
 * The API stores only a prebuilt dashboard's identity and user state; widgets
 * live in `views/dashboards/utils/prebuiltConfigs/` in Sentry Web. The generated
 * catalog is refreshed by `scripts/sync-prebuilt-dashboards.ts`, and the weekly
 * frontend drift check reports when its source definitions change upstream.
 */

import type { DashboardDetails, DashboardListItem, DashboardWidget } from "~/api/dashboards";

import generated from "./prebuiltDashboards.generated.json";

interface PrebuiltDashboardDefinition {
  description: string;
  title: string;
  widgets: DashboardWidget[];
}

const PREBUILT_DASHBOARDS = generated.dashboards as unknown as Readonly<
  Record<number, PrebuiltDashboardDefinition>
>;

/** Hydrate list metadata the API deliberately omits for a known prebuilt. */
export function withPrebuiltListMetadata(dashboard: DashboardListItem): DashboardListItem {
  if (dashboard.prebuiltId == null) return dashboard;
  const definition = PREBUILT_DASHBOARDS[dashboard.prebuiltId];
  if (!definition) return dashboard;

  return {
    ...dashboard,
    description: dashboard.description || definition.description,
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
