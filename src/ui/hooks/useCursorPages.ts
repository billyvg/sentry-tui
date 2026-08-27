import { useCallback, useEffect, useRef, useState } from "react";

import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";

export interface CursorPage<T> {
  data: T;
  nextCursor: string | null;
}

export type CursorPageLoader<T> = (
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<CursorPage<T>> | null;

export interface CursorPagesState<T> {
  status: AsyncStatus<CursorPage<T>>;
  nextCursor: string | null;
  /** Cursor which produced the page on screen; absent on page one. */
  cursor: string | undefined;
  /** One-based page number. */
  page: number;
  nextPage: () => boolean;
  previousPage: () => boolean;
}

/**
 * Fetch cursor-backed pages and retain the cursors needed to walk backward.
 *
 * Sentry does not expose previous cursors consistently across all list APIs,
 * so the hook remembers each cursor it followed. A refresh reuses the page on
 * screen, while a changed loader (query, sort, filters, or client) resets to
 * page one. Superseded requests are aborted and guarded by identity.
 */
export function useCursorPages<T>(
  loader: CursorPageLoader<T>,
  reloadKey: unknown = 0,
): CursorPagesState<T> {
  const [status, setStatus] = useState<AsyncStatus<CursorPage<T>>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const statusRef = useRef(status);
  statusRef.current = status;
  const cursorRef = useRef<string | undefined>(undefined);
  const pageRef = useRef(1);
  const cursorHistoryRef = useRef<Array<string | undefined>>([undefined]);
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  /** Request one cursor and commit its page metadata only after it settles. */
  const requestPage = useCallback(
    (requestedCursor: string | undefined, targetPage: number): boolean => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const requestId = ++requestIdRef.current;

      let request: Promise<CursorPage<T>> | null;
      try {
        request = loader(requestedCursor, controller.signal);
      } catch (error) {
        setStatus((current) => rejected(current, toAsyncError(error)));
        return false;
      }
      if (request === null) {
        setStatus(idle);
        return false;
      }

      const loading = startLoading(statusRef.current, Date.now());
      statusRef.current = loading;
      setStatus(loading);

      void request
        .then((result) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) return;
          cursorRef.current = requestedCursor;
          pageRef.current = targetPage;
          cursorHistoryRef.current[targetPage - 1] = requestedCursor;
          cursorHistoryRef.current.length = targetPage;
          setCursor(requestedCursor);
          setPage(targetPage);
          setNextCursor(result.nextCursor);
          setStatus(resolved(result, Date.now()));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current) return;
          setStatus((current) => rejected(current, toAsyncError(error)));
        });

      return true;
    },
    [loader],
  );

  const previousRequestPage = useRef<typeof requestPage | null>(null);

  const nextPage = useCallback(() => {
    if (nextCursor === null || statusRef.current.state === "loading") return false;
    return requestPage(nextCursor, pageRef.current + 1);
  }, [nextCursor, requestPage]);

  const previousPage = useCallback(() => {
    if (pageRef.current <= 1 || statusRef.current.state === "loading") return false;
    return requestPage(cursorHistoryRef.current[pageRef.current - 2], pageRef.current - 1);
  }, [requestPage]);

  useEffect(() => {
    const queryChanged = previousRequestPage.current !== requestPage;
    previousRequestPage.current = requestPage;
    if (queryChanged) {
      cursorRef.current = undefined;
      pageRef.current = 1;
      cursorHistoryRef.current = [undefined];
      setCursor(undefined);
      setPage(1);
      setNextCursor(null);
    }
    requestPage(cursorRef.current, pageRef.current);
  }, [requestPage, reloadKey]);

  useEffect(
    () => () => {
      requestIdRef.current++;
      requestRef.current?.abort();
    },
    [],
  );

  return { status, nextCursor, cursor, page, nextPage, previousPage };
}
