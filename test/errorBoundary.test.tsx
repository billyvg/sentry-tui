import { afterEach, beforeEach, expect, test } from "bun:test";

import { ErrorBoundary } from "@sentry-tui/runtime-host/ui/ErrorBoundary";
import { renderHarness } from "./helpers";

function Exploding(): never {
  throw new Error("the screen fell over");
}

// React logs every error a boundary catches, and the dump is several screens
// long. These tests throw on purpose, so that output is noise hiding signal.
const realConsoleError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = realConsoleError;
});

test("a crashed screen becomes something readable instead of a frozen frame", async () => {
  const harness = await renderHarness(
    <ErrorBoundary onQuit={() => {}}>
      <Exploding />
    </ErrorBoundary>,
  );

  const frame = harness.frame();
  expect(frame).toContain("sentry-tui hit an error");
  expect(frame).toContain("the screen fell over");
  expect(frame).toContain("Press q to quit");

  await harness.cleanup();
});

test("q quits, since the crashed tree took every other key handler with it", async () => {
  let quit = 0;
  const harness = await renderHarness(
    <ErrorBoundary
      onQuit={() => {
        quit++;
      }}
    >
      <Exploding />
    </ErrorBoundary>,
  );

  await harness.press((input) => input.pressKey("q"));
  expect(quit).toBe(1);

  await harness.cleanup();
});

test("a healthy tree renders untouched", async () => {
  const harness = await renderHarness(
    <ErrorBoundary onQuit={() => {}}>
      <text>all is well</text>
    </ErrorBoundary>,
  );

  expect(harness.frame()).toContain("all is well");

  await harness.cleanup();
});
