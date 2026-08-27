import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export type DirectResourceLoader<T> = (
  client: SentryClient,
  options: { org: string; id: string; signal: AbortSignal },
) => Promise<T>;

/** Fetch one URL-addressed resource and cancel it when the destination changes. */
export function useDirectResource<T>(
  client: SentryClient | null,
  {
    org,
    id,
    reloadToken = 0,
    load,
  }: { org: string; id: string; reloadToken?: number; load: DirectResourceLoader<T> },
): AsyncStatus<T> {
  const [status, setStatus] = useState<AsyncStatus<T>>(idle);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    let cancelled = false;
    setStatus(startLoading(statusRef.current, Date.now()));

    void load(client, { org, id, signal: controller.signal })
      .then((value) => {
        if (!cancelled) setStatus(resolved(value, Date.now()));
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setStatus(rejected(statusRef.current, toAsyncError(error)));
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, id, reloadToken, load]);

  return status;
}
