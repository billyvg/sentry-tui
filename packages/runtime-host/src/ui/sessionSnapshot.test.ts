import { describe, expect, test } from "bun:test";

import { cloneSessionSnapshot } from "@sentry-tui/runtime-host/ui/sessionSnapshot";

describe("runtime session snapshot boundary", () => {
  test("returns a detached JSON clone", () => {
    const original = { version: 1, navigation: { viewStack: ["one"] } };
    const clone = cloneSessionSnapshot(original) as typeof original;
    original.navigation.viewStack.push("two");
    expect(clone).toEqual({ version: 1, navigation: { viewStack: ["one"] } });
  });

  test("rejects non-JSON, cyclic, and oversized values", () => {
    expect(cloneSessionSnapshot({ callback: () => {} })).toBeUndefined();
    expect(cloneSessionSnapshot({ promise: Promise.resolve() })).toBeUndefined();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(cloneSessionSnapshot(cyclic)).toBeUndefined();
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("nope");
        },
      },
    );
    expect(cloneSessionSnapshot(hostile)).toBeUndefined();
    expect(cloneSessionSnapshot({ body: "x".repeat(300_000) })).toBeUndefined();
  });
});
