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
  {
    org,
    issueId,
    reloadToken = 0,
  }: {
    org: string;
    issueId: string | null;
    /** Bump to refetch the same issue — the app's global refresh. */
    reloadToken?: number;
  },
): AsyncStatus<SentryEvent> {
  const [event, setEvent] = useState<AsyncStatus<SentryEvent>>(idle);
  const eventRef = useRef(event);
  eventRef.current = event;
  const lastIssueId = useRef<string | null>(null);

  useEffect(() => {
    if (!client || !issueId) {
      lastIssueId.current = null;
      setEvent(idle());
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // A different issue means the previous body is not "stale", it's wrong —
    // start clean rather than carrying it forward. A refresh of the *same*
    // issue keeps it, so the screen doesn't flash back to a skeleton.
    const sameIssue = lastIssueId.current === issueId;
    lastIssueId.current = issueId;
    setEvent(startLoading(sameIssue ? eventRef.current : idle(), Date.now()));

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
  }, [client, org, issueId, reloadToken]);

  return event;
}
