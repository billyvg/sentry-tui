import { expect, test } from "bun:test";
import { act, useCallback, useState } from "react";

import { valueOf } from "~/core/async";
import { useCursorPages, type CursorPage, type CursorPagesState } from "~/ui/hooks/useCursorPages";
import { renderHarness } from "./helpers";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** Promise controlled by the test, so every page transition is observable. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface Request {
  query: string;
  cursor: string | undefined;
  signal: AbortSignal;
  deferred: Deferred<CursorPage<string>>;
}

interface Controls {
  setQuery: (query: string) => void;
  refresh: () => void;
  result?: CursorPagesState<string>;
}

function Probe({ requests, controls }: { requests: Request[]; controls: Controls }) {
  const [query, setQuery] = useState("first");
  const [reload, setReload] = useState(0);
  const loader = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => {
      const request = deferred<CursorPage<string>>();
      requests.push({ query, cursor, signal, deferred: request });
      return request.promise;
    },
    [query, requests],
  );
  const result = useCursorPages(loader, reload);
  controls.setQuery = setQuery;
  controls.refresh = () => setReload((value) => value + 1);
  controls.result = result;
  return (
    <text>{`${result.status.state}:${valueOf(result.status)?.data ?? "-"}:p${result.page}`}</text>
  );
}

test("cursor pages walk forward and backward through remembered cursors", async () => {
  const requests: Request[] = [];
  const controls = {} as Controls;
  const h = await renderHarness(<Probe requests={requests} controls={controls} />, {
    width: 30,
    height: 2,
  });

  await act(async () => requests[0]!.deferred.resolve({ data: "one", nextCursor: "next" }));
  await h.flush();
  expect(h.frame()).toContain("ready:one:p1");

  let moved = false;
  await act(async () => {
    moved = controls.result!.nextPage();
  });
  expect(moved).toBe(true);
  await act(async () => requests[1]!.deferred.resolve({ data: "two", nextCursor: null }));
  await h.flush();
  expect(requests[1]?.cursor).toBe("next");
  expect(h.frame()).toContain("ready:two:p2");

  await act(async () => {
    moved = controls.result!.previousPage();
  });
  expect(moved).toBe(true);
  await act(async () => requests[2]!.deferred.resolve({ data: "one-again", nextCursor: "next" }));
  await h.flush();
  expect(requests[2]?.cursor).toBeUndefined();
  expect(h.frame()).toContain("ready:one-again:p1");
  await h.cleanup();
});

test("refresh keeps the current cursor while a changed query resets to page one", async () => {
  const requests: Request[] = [];
  const controls = {} as Controls;
  const h = await renderHarness(<Probe requests={requests} controls={controls} />, {
    width: 30,
    height: 2,
  });

  await act(async () => requests[0]!.deferred.resolve({ data: "one", nextCursor: "next" }));
  await h.flush();
  await act(async () => {
    controls.result!.nextPage();
  });
  await act(async () => requests[1]!.deferred.resolve({ data: "two", nextCursor: null }));
  await h.flush();

  await act(async () => controls.refresh());
  expect(requests[2]?.cursor).toBe("next");
  await act(async () => requests[2]!.deferred.resolve({ data: "two-fresh", nextCursor: null }));
  await h.flush();
  expect(h.frame()).toContain("ready:two-fresh:p2");

  await act(async () => controls.setQuery("changed"));
  expect(requests[3]?.query).toBe("changed");
  expect(requests[3]?.cursor).toBeUndefined();
  await act(async () => requests[3]!.deferred.resolve({ data: "new-one", nextCursor: null }));
  await h.flush();
  expect(h.frame()).toContain("ready:new-one:p1");
  await h.cleanup();
});
