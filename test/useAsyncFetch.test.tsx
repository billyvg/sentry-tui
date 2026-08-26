import { describe, expect, test } from "bun:test";
import { act, useCallback, useState } from "react";

import { valueOf, type AsyncStatus } from "~/core/async";
import {
  useAsyncFetch,
  type AsyncLoader,
  type UseAsyncFetchResult,
} from "~/ui/hooks/useAsyncFetch";
import { renderHarness } from "./helpers";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface Controls {
  setKey: (key: string) => void;
  result?: UseAsyncFetchResult<string>;
}

function statusLabel(status: AsyncStatus<string>): string {
  return `${status.state}:${valueOf(status) ?? "-"}`;
}

function Probe({
  load,
  controls,
  resetWithKey = false,
}: {
  load: (key: string, signal: AbortSignal) => Promise<string> | null;
  controls: Controls;
  resetWithKey?: boolean;
}) {
  const [key, setKey] = useState("first");
  const loader = useCallback<AsyncLoader<string>>((signal) => load(key, signal), [key, load]);
  const result = useAsyncFetch(loader, { resetKey: resetWithKey ? key : undefined });
  controls.setKey = setKey;
  controls.result = result;
  return <text>{statusLabel(result.status)}</text>;
}

describe("useAsyncFetch", () => {
  test("retains settled data through a manual refresh and a failure", async () => {
    const requests: Deferred<string>[] = [];
    const load = () => {
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    };
    const controls = {} as Controls;
    const h = await renderHarness(<Probe load={load} controls={controls} />, {
      width: 30,
      height: 2,
    });

    expect(h.frame()).toContain("loading:-");
    await act(async () => requests[0]!.resolve("settled"));
    await h.flush();
    expect(h.frame()).toContain("ready:settled");

    await act(async () => controls.result!.refetch());
    await h.flush();
    expect(h.frame()).toContain("loading:settled");

    await act(async () => requests[1]!.reject(new Error("nope")));
    await h.flush();
    expect(h.frame()).toContain("error:settled");
    await h.cleanup();
  });

  test("aborts and ignores a superseded loader even when it resolves", async () => {
    const requests = new Map<string, Deferred<string>>();
    const signals = new Map<string, AbortSignal>();
    const load = (key: string, signal: AbortSignal) => {
      const request = deferred<string>();
      requests.set(key, request);
      signals.set(key, signal);
      return request.promise;
    };
    const controls = {} as Controls;
    const h = await renderHarness(<Probe load={load} controls={controls} />, {
      width: 30,
      height: 2,
    });

    await act(async () => controls.setKey("second"));
    await h.flush();
    expect(signals.get("first")?.aborted).toBe(true);

    await act(async () => requests.get("first")!.resolve("stale"));
    await h.flush();
    expect(h.frame()).not.toContain("stale");

    await act(async () => requests.get("second")!.resolve("current"));
    await h.flush();
    expect(h.frame()).toContain("ready:current");
    await h.cleanup();
  });

  test("drops stale data when the reset key changes", async () => {
    const requests = new Map<string, Deferred<string>>();
    const load = (key: string) => {
      const request = deferred<string>();
      requests.set(key, request);
      return request.promise;
    };
    const controls = {} as Controls;
    const h = await renderHarness(<Probe load={load} controls={controls} resetWithKey />, {
      width: 30,
      height: 2,
    });

    await act(async () => requests.get("first")!.resolve("old-screen"));
    await h.flush();
    await act(async () => controls.setKey("second"));
    await h.flush();
    expect(h.frame()).toContain("loading:-");
    expect(h.frame()).not.toContain("old-screen");
    await h.cleanup();
  });

  test("uses idle for a skipped loader and aborts on unmount", async () => {
    let signal: AbortSignal | undefined;
    const controls = {} as Controls;
    const h = await renderHarness(
      <Probe
        controls={controls}
        load={(key, nextSignal) => {
          if (key === "first") return null;
          signal = nextSignal;
          return new Promise(() => {});
        }}
      />,
      { width: 30, height: 2 },
    );

    expect(h.frame()).toContain("idle:-");
    await act(async () => controls.setKey("second"));
    await h.flush();
    expect(h.frame()).toContain("loading:-");
    await h.cleanup();
    expect(signal?.aborted).toBe(true);
  });
});
