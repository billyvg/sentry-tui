import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  fetchWidgetData,
  widgetDataset,
  widgetRenderKind,
  type WidgetData,
} from "~/api/dashboardWidgets";
import { getDashboard, type DashboardDetails, type DashboardWidget } from "~/api/dashboards";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";
import { withPrebuiltDetails } from "~/core/prebuiltDashboards";

/** Fetch a dashboard and its widget definitions. One request. */
export function useDashboardDetail(
  client: SentryClient | null,
  { org, id, reloadToken = 0 }: { org: string; id: string; reloadToken?: number },
): AsyncStatus<DashboardDetails> {
  const [status, setStatus] = useState<AsyncStatus<DashboardDetails>>(idle);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const dashboard = await getDashboard(client, { org, id, signal });
        if (!cancelled) setStatus(resolved(withPrebuiltDetails(dashboard), Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, id, reloadToken]);

  return status;
}

// ---------------------------------------------------------------------------
// Widget data
// ---------------------------------------------------------------------------

/**
 * Per-widget data, `null` for a widget there is nothing to fetch for.
 *
 * A widget with no id — one that has never been saved — is keyed by position,
 * which is stable for as long as the dashboard response is.
 */
export type WidgetDataMap = ReadonlyMap<string, AsyncStatus<WidgetData | null>>;

/** The key a widget's data is stored under. */
export function widgetKey(widget: DashboardWidget, index: number): string {
  return widget.id ?? `#${index}`;
}

export interface WidgetDataQuery {
  org: string;
  /** Refetch everything when this changes — a different dashboard is open. */
  dashboardId: string;
  /** The widgets, in the order they are drawn. Must be referentially stable. */
  widgets: readonly DashboardWidget[];
  /**
   * How far down the stack to fetch. The screen raises it as the cursor moves,
   * so opening a thirty-widget dashboard costs three requests rather than
   * thirty-one.
   */
  upto: number;
  statsPeriod?: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch; the app's global refresh. */
  reloadToken?: number;
}

/**
 * Fetch each widget's data, one widget at a time, in the order they are drawn.
 *
 * Two things this deliberately does *not* do. It doesn't fan out: a dashboard
 * may hold thirty widgets (`MAX_WIDGETS`), and thirty simultaneous `events/`
 * calls is a rate limit waiting to happen, so requests are chained and a
 * widget's turn comes when the ones above it are done. And it doesn't refetch:
 * a widget already asked for keeps its answer until the filters, the
 * dashboard, or `reloadToken` change, so holding `j` costs nothing.
 */
export function useWidgetData(
  client: SentryClient | null,
  {
    org,
    dashboardId,
    widgets,
    upto,
    statsPeriod,
    project,
    environment,
    reloadToken = 0,
  }: WidgetDataQuery,
): WidgetDataMap {
  const [results, setResults] = useState<WidgetDataMap>(() => new Map());

  // Everything a request depends on but the widget itself. Serialised because
  // the filter arrays are rebuilt every render, and compared by identity they
  // would restart every fetch on every keystroke.
  const queryKey = JSON.stringify([
    org,
    dashboardId,
    statsPeriod,
    project ?? null,
    environment ?? null,
    reloadToken,
  ]);

  const params = useRef({ org, statsPeriod, project, environment });
  params.current = { org, statsPeriod, project, environment };

  /** Widgets already asked for under the current `queryKey`. */
  const requested = useRef(new Set<string>());
  /** The tail of the request chain — what a new fetch queues behind. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const controller = useRef<AbortController | null>(null);

  // A new query invalidates every answer, so the map, the chain and the
  // in-flight requests all start again. Declared before the fetch effect so it
  // runs first in the commit that changed the key.
  useEffect(() => {
    requested.current = new Set();
    chain.current = Promise.resolve();
    setResults(new Map());

    const next = new AbortController();
    controller.current = next;
    return () => next.abort();
  }, [queryKey]);

  useEffect(() => {
    if (!client) return;
    const abort = controller.current;
    if (!abort) return;

    const limit = Math.min(widgets.length, Math.max(0, upto));
    for (let index = 0; index < limit; index++) {
      const widget = widgets[index]!;
      const key = widgetKey(widget, index);
      if (requested.current.has(key)) continue;
      requested.current.add(key);

      // Nothing to ask for: the card draws its own honest placeholder.
      if (!isFetchable(widget)) {
        setResults((map) => withEntry(map, key, resolved(null, Date.now())));
        continue;
      }

      setResults((map) => withEntry(map, key, startLoading(undefined, Date.now())));

      chain.current = chain.current.then(async () => {
        if (abort.signal.aborted) return;
        try {
          const data = await fetchWidgetData(client, {
            ...params.current,
            widget,
            signal: abort.signal,
          });
          if (!abort.signal.aborted) {
            setResults((map) => withEntry(map, key, resolved(data, Date.now())));
          }
        } catch (error) {
          if (abort.signal.aborted) return;
          setResults((map) => withEntry(map, key, rejected(undefined, toAsyncError(error))));
        }
      });
    }
    // `queryKey` stands in for the filters; the fetch reads their live values
    // through `params`.
  }, [client, widgets, upto, queryKey]);

  return results;
}

/** Whether a widget has data this client can go and get. */
export function isFetchable(widget: DashboardWidget): boolean {
  return (
    widgetRenderKind(widget.displayType) !== "unsupported" &&
    widgetDataset(widget.widgetType) !== null &&
    widget.queries.length > 0
  );
}

function withEntry(
  map: WidgetDataMap,
  key: string,
  value: AsyncStatus<WidgetData | null>,
): WidgetDataMap {
  const next = new Map(map);
  next.set(key, value);
  return next;
}
