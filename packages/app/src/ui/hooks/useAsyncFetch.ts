import { useCallback, useEffect, useRef, useState } from "react";

import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export type AsyncLoader<T> = (signal: AbortSignal) => Promise<T> | null;

export interface UseAsyncFetchOptions {
  /** Refetch when this value changes, even when the loader is otherwise stable. */
  reloadKey?: unknown;
  /** Drop stale data instead of carrying it across a change to this value. */
  resetKey?: unknown;
}

export interface UseAsyncFetchResult<T> {
  status: AsyncStatus<T>;
  refetch: () => void;
}

/**
 * Run an abortable loader and expose the app's stale-while-refreshing state.
 *
 * Superseded promises are guarded by identity as well as cancellation because
 * not every loader honors its signal. Returning `null` skips the request and
 * restores the idle state.
 */
export function useAsyncFetch<T>(
  loader: AsyncLoader<T>,
  { reloadKey, resetKey }: UseAsyncFetchOptions = {},
): UseAsyncFetchResult<T> {
  const [status, setStatus] = useState<AsyncStatus<T>>(idle);
  const [manualReload, setManualReload] = useState(0);
  const requestIdRef = useRef(0);
  const resetKeyRef = useRef(resetKey);

  const refetch = useCallback(() => setManualReload((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const reset = !Object.is(resetKeyRef.current, resetKey);
    resetKeyRef.current = resetKey;

    let promise: Promise<T> | null;
    try {
      promise = loader(controller.signal);
    } catch (error) {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setStatus((current) => rejected(reset ? undefined : current, toAsyncError(error)));
      }
      return () => {
        requestIdRef.current++;
        controller.abort();
      };
    }

    if (promise === null) {
      setStatus(idle);
      return () => {
        requestIdRef.current++;
        controller.abort();
      };
    }

    setStatus((current) => startLoading(reset ? undefined : current, Date.now()));

    void promise
      .then((value) => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) {
          setStatus(resolved(value, Date.now()));
        }
      })
      .catch((error: unknown) => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) {
          setStatus((current) => rejected(current, toAsyncError(error)));
        }
      });

    return () => {
      requestIdRef.current++;
      controller.abort();
    };
  }, [loader, reloadKey, resetKey, manualReload]);

  return { status, refetch };
}
