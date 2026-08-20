import { useEffect, useRef, useState } from "react";

import { ApiError, type SentryClient } from "~/api/client";
import { fetchIssueEvent } from "~/api/issues";
import type { SentryEvent } from "~/api/types";
import { type AsyncStatus, idle, rejected, resolved, startLoading } from "~/core/async";

/**
 * Fetch the latest event for an issue.
 *
 * Opening another issue aborts the in-flight request, so fast j/k browsing
 * doesn't queue a backlog of responses that land out of order.
 */
export function useIssueEvent(
  client: SentryClient | null,
  { org, issueId }: { org: string; issueId: string | null },
): AsyncStatus<SentryEvent> {
  const [event, setEvent] = useState<AsyncStatus<SentryEvent>>(idle);
  const eventRef = useRef(event);
  eventRef.current = event;

  useEffect(() => {
    if (!client || !issueId) {
      setEvent(idle());
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // A different issue means the previous body is not "stale", it's wrong —
    // start clean rather than carrying it forward.
    setEvent(startLoading(idle(), Date.now()));

    void (async () => {
      try {
        const result = await fetchIssueEvent(client, {
          org,
          issueId,
          signal: controller.signal,
        });
        if (cancelled) return;
        setEvent(resolved(result, Date.now()));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setEvent(
          rejected(eventRef.current, {
            message: error instanceof Error ? error.message : String(error),
            retryable: error instanceof ApiError ? error.retryable : true,
          }),
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, issueId]);

  return event;
}
