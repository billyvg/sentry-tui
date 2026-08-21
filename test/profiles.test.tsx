import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { formatNanoseconds } from "~/ui/screens/ProfileFunctions";
import { rawProfileFunctionRowsFixture } from "./profile-fixtures";
import { renderHarness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 34;

/** Profiles is the sixth item in Explore's first nav section. */
const PROFILES_INDEX = 5;

function stubClient(rows: unknown = rawProfileFunctionRowsFixture) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/events/") && url.includes("dataset=profileFunctions")) {
      return json({ data: rows });
    }
    return json([]);
  }) as unknown as typeof fetch;

  return new SentryClient({ auth, fetchImpl, maxRetries: 0 });
}

/** Navigate to Explore › Profiles. */
async function navigateToProfiles(h: Awaited<ReturnType<typeof renderHarness>>) {
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
  for (let i = 0; i < PROFILES_INDEX; i++) await h.press((k) => k.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

async function openProfiles(client: SentryClient = stubClient()) {
  const h = await renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  await h.waitForFrame((f) => f.includes("Feed") || f.includes("No issues"));
  await navigateToProfiles(h);
  return h;
}

test("navigating to Explore > Profiles shows the slowest-functions table", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("QuerySet._fetch_all"));
    const frame = h.frame();
    expect(frame).toContain("Search functions");
    expect(frame).toContain("Function");
    expect(frame).toContain("Self Time");
    expect(frame).toContain("QuerySet._fetch_all");
    expect(frame).toContain("django/db/models");
    expect(frame).toContain("backend");
  } finally {
    await h.cleanup();
  }
});

test("the pane says where the aggregate flamegraph is instead of drawing one", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("Aggregate flamegraph"));
    const frame = h.frame();
    expect(frame).toContain("Aggregate flamegraph");
    expect(frame).toContain("sentry.io");
    expect(frame).toContain("A flamegraph needs pixels a terminal does not have");
  } finally {
    await h.cleanup();
  }
});

test("durations are rendered in the largest unit that fits", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("QuerySet._fetch_all"));
    const frame = h.frame();
    // 42.1s total self time, 3.4ms at p75.
    expect(frame).toContain("42.1s");
    expect(frame).toContain("3.4ms");
    // 240_000ns is 240µs — the smallest row exercises the sub-millisecond unit.
    expect(frame).toContain("240µs");
  } finally {
    await h.cleanup();
  }
});

test("enter opens a detail panel with the full function name", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("QuerySet._fetch_all"));
    expect(h.frame()).not.toContain("Function Details");

    await h.press((i) => i.pressEnter());

    const frame = h.frame();
    expect(frame).toContain("Function Details");
    expect(frame).toContain("Package: django/db/models");
    expect(frame).toContain("Project: backend");

    // Escape closes the panel without leaving the screen.
    await h.pressEscape();
    expect(h.frame()).not.toContain("Function Details");
    expect(h.frame()).toContain("QuerySet._fetch_all");
  } finally {
    await h.cleanup();
  }
});

test("the detail panel follows the cursor", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("QuerySet._fetch_all"));
    await h.press((i) => i.pressEnter());
    expect(h.frame()).toContain("Package: django/db/models");

    await h.press((i) => i.pressKey("j"));
    const frame = h.frame();
    expect(frame).toContain("Package: sentry/utils");
    expect(frame).not.toContain("Package: django/db/models");
  } finally {
    await h.cleanup();
  }
});

test("an empty result names the possibility that profiling is not enabled", async () => {
  const h = await openProfiles(stubClient([]));
  try {
    await h.waitForFrame((f) => f.includes("No profiled functions found"));
    const frame = h.frame();
    expect(frame).toContain("No profiled functions found");
    expect(frame).toContain("may not have profiling enabled");
  } finally {
    await h.cleanup();
  }
});

test("the status bar counts the functions on screen", async () => {
  const h = await openProfiles();
  try {
    await h.waitForFrame((f) => f.includes("4 functions"));
    expect(h.frame()).toContain("4 functions");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("nanoseconds are rendered in the largest unit that keeps three figures", () => {
  expect(formatNanoseconds(undefined)).toBe("··");
  expect(formatNanoseconds(380)).toBe("380ns");
  expect(formatNanoseconds(240_000)).toBe("240\u00b5s");
  expect(formatNanoseconds(3_400_000)).toBe("3.4ms");
  // A whole number keeps its zeroes: 1_000_000ns is 1ms, not 1ns.
  expect(formatNanoseconds(1_000_000)).toBe("1ms");
  expect(formatNanoseconds(1_000_000_000)).toBe("1s");
  expect(formatNanoseconds(42_100_000_000)).toBe("42.1s");
});
