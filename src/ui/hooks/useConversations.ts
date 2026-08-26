/**
 * The conversation list and the chart above it, as async state.
 *
 * Two endpoints, one hook: the table comes from `/ai-conversations/` and the
 * chart from Discover's `events-stats/` over the same gen-AI spans, which is
 * how the web draws them too. Shaped like `useExploreEvents` — both requests
 * share the same filters and reload key, and neither polls.
 */

import { useCallback } from "react";

import { listConversations, type Conversation } from "~/api/aiConversations";
import type { SentryClient } from "~/api/client";
import type { TimeseriesBucket } from "~/api/discover";
import { listExploreTimeseries } from "~/api/exploreEvents";
import { mapAsyncStatus, valueOf, type AsyncStatus } from "~/core/async";
import { CONVERSATION_CHART, CONVERSATION_SPAN_FILTER } from "~/core/conversations";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

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
  nextCursor: string | null;
}

export function useConversations(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, reloadToken = 0 }: ConversationsQuery,
): ConversationsState {
  const conversationsLoader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listConversations(client, { org, query, statsPeriod, project, environment, signal })
        : null,
    [client, org, query, statsPeriod, project, environment],
  );
  const timeseriesLoader = useCallback(
    (signal: AbortSignal) =>
      client
        ? listExploreTimeseries(client, {
            org,
            statsPeriod,
            project,
            environment,
            signal,
            dataset: "spans",
            // The chart counts conversations, not the spans they are made of,
            // and needs the span filter the list endpoint applies for itself.
            yAxis: CONVERSATION_CHART.yAxis,
            query: [CONVERSATION_SPAN_FILTER, query.trim()].filter(Boolean).join(" "),
            referrer: "sentry-tui.explore-conversations-chart",
          })
        : null,
    [client, org, query, statsPeriod, project, environment],
  );
  const conversationsStatus = useAsyncFetch(conversationsLoader, {
    reloadKey: reloadToken,
  }).status;
  const timeseries = useAsyncFetch(timeseriesLoader, { reloadKey: reloadToken }).status;

  return {
    conversations: mapAsyncStatus(conversationsStatus, (page) => page.data),
    timeseries,
    nextCursor: valueOf(conversationsStatus)?.nextCursor ?? null,
  };
}
