/**
 * The conversation list and the chart above it, as async state.
 *
 * Two endpoints, one hook: the table comes from `/ai-conversations/` and the
 * chart from Discover's `events-stats/` over the same gen-AI spans, which is
 * how the web draws them too. Shaped like `useExploreEvents` — one
 * `AbortController`, `reloadToken` in the dependencies, and no polling.
 */

import { useEffect, useRef, useState } from "react";

import { listConversations, type Conversation } from "~/api/aiConversations";
import type { SentryClient } from "~/api/client";
import type { TimeseriesBucket } from "~/api/discover";
import { listExploreTimeseries } from "~/api/exploreEvents";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";
import { CONVERSATION_CHART, CONVERSATION_SPAN_FILTER } from "~/core/conversations";

export interface ConversationsQuery {
  org: string;
  /** The user's committed query. */
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ConversationsState {
  conversations: AsyncStatus<Conversation[]>;
  timeseries: AsyncStatus<TimeseriesBucket[]>;
}

export function useConversations(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, reloadToken = 0 }: ConversationsQuery,
): ConversationsState {
  const [conversations, setConversations] = useState<AsyncStatus<Conversation[]>>(idle);
  const [timeseries, setTimeseries] = useState<AsyncStatus<TimeseriesBucket[]>>(idle);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const timeseriesRef = useRef(timeseries);
  timeseriesRef.current = timeseries;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setConversations(startLoading(conversationsRef.current, Date.now()));
    setTimeseries(startLoading(timeseriesRef.current, Date.now()));

    const filters = { org, statsPeriod, project, environment, signal };

    void (async () => {
      try {
        const page = await listConversations(client, { ...filters, query });
        if (cancelled) return;
        setConversations(resolved(page.data, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setConversations(rejected(conversationsRef.current, toAsyncError(error)));
      }
    })();

    void (async () => {
      try {
        const buckets = await listExploreTimeseries(client, {
          ...filters,
          dataset: "spans",
          // The chart counts conversations, not the spans they are made of,
          // and needs the span filter the list endpoint applies for itself.
          yAxis: CONVERSATION_CHART.yAxis,
          query: [CONVERSATION_SPAN_FILTER, query.trim()].filter(Boolean).join(" "),
          referrer: "sentry-tui.explore-conversations-chart",
        });
        if (cancelled) return;
        setTimeseries(resolved(buckets, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        // A missing chart is a smaller loss than a missing list.
        setTimeseries(rejected(timeseriesRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, reloadToken]);

  return { conversations, timeseries };
}
