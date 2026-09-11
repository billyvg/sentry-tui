import { expect, test } from "bun:test";
import { act, useState } from "react";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { fetchProfileSummary, summarizeProfile } from "~/api/profileDetails";
import { fetchTraceSpans } from "~/api/traceDetails";
import { SeerBlockEmbed } from "~/ui/components/SeerEmbeds";
import { sampledProfileFixture, traceSpansFixture } from "./fixtures";
import { renderHarness } from "./helpers";

/** A real client with deterministic HTTP responses, recording scopes and cancellation. */
function stub(payload: unknown, status = 200) {
  const requests: Array<{ url: URL; signal?: AbortSignal | null }> = [];
  const client = new SentryClient({
    auth: createTokenAuthProvider({ token: "test" }),
    maxRetries: 0,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: new URL(String(input)), signal: init?.signal });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { client, requests };
}

test("trace fetch ranks inclusive duration, traverses children, scopes ISO timestamps and forwards aborts", async () => {
  const { client, requests } = stub([
    ...traceSpansFixture,
    null,
    { event_type: "error" },
    { event_type: "span", event_id: "bad", start_timestamp: null, end_timestamp: 2 },
  ]);
  const signal = new AbortController().signal;
  const spans = await fetchTraceSpans(client, {
    org: "acme",
    traceId: "trace",
    timestamp: "2026-08-20T12:00:00Z",
    signal,
  });
  expect(spans.map((span) => span.id)).toEqual(["root", "db", "cache"]);
  expect(spans[0]!.durationMs).toBe(1000);
  expect(requests[0]!.url.pathname).toBe("/api/0/organizations/acme/trace/trace/");
  expect(requests[0]!.url.searchParams.get("timestamp")).toBe(
    String(Date.parse("2026-08-20T12:00:00Z") / 1000),
  );
  expect(requests[0]!.url.searchParams.has("statsPeriod")).toBe(false);
  expect(requests[0]!.signal).toBeDefined();
  await fetchTraceSpans(client, { org: "acme", traceId: "trace", timestamp: "invalid" });
  expect(requests[1]!.url.searchParams.get("statsPeriod")).toBe("14d");
});

test("profile self time uses leaf-first stacks and intervals within each thread", async () => {
  const { client, requests } = stub(sampledProfileFixture);
  const profile = await fetchProfileSummary(client, {
    org: "acme",
    projectSlug: "checkout",
    profileId: "profile",
  });
  expect(requests[0]!.url.pathname).toBe(
    "/api/0/projects/acme/checkout/profiling/profiles/profile/",
  );
  expect(profile.unit).toBe("ms");
  expect(profile.frames.map(({ name, weight }) => [name, weight])).toEqual([
    ["json_decode", 20],
    ["checkout", 10],
    ["background", 5],
  ]);
});

test("legacy sampled and evented profiles use root-first stacks and explicit time units", () => {
  const shared = { frames: [{ name: "root" }, { name: "leaf" }] };
  const sampled = summarizeProfile({
    shared,
    profiles: [
      { type: "sampled", unit: "microseconds", samples: [[0, 1], [0]], weights: [2000, 1000] },
    ],
  });
  expect(sampled.frames.map(({ id, weight }) => [id, weight])).toEqual([
    [1, 2],
    [0, 1],
  ]);
  const evented = summarizeProfile({
    shared,
    profiles: [
      {
        type: "evented",
        unit: "milliseconds",
        startValue: 0,
        endValue: 5,
        events: [
          { type: "O", frame: 0, at: 0 },
          { type: "O", frame: 1, at: 1 },
          { type: "C", frame: 1, at: 4 },
          { type: "C", frame: 0, at: 5 },
        ],
      },
    ],
  });
  expect(evented.frames.map(({ id, weight }) => [id, weight])).toEqual([
    [1, 3],
    [0, 2],
  ]);
  const counts = summarizeProfile({
    shared,
    profiles: [{ type: "sampled", unit: "count", samples: [[0, 1]], weights: [7] }],
  });
  expect(counts.unit).toBe("samples");
  expect(counts.frames[0]!.weight).toBe(7);
});

test("empty legacy profiles retain the default time unit", () => {
  expect(summarizeProfile({ shared: { frames: [] }, profiles: [] })).toEqual({
    transaction: undefined,
    unit: "ms",
    frames: [],
  });
});

test("profile normalizer skips broken references and rejects unsupported payloads", () => {
  expect(
    summarizeProfile({
      profile: {
        frames: [],
        stacks: [],
        samples: [
          { stack_id: 50, elapsed_since_start_ns: 0 },
          { stack_id: -1, elapsed_since_start_ns: 1 },
        ],
      },
    }).frames,
  ).toEqual([]);
  expect(() => summarizeProfile({})).toThrow("Invalid profile response");
  expect(() => summarizeProfile({ profile: { frames: [] } })).toThrow("Unsupported profile format");
});

test.each([100, 40])("live performance cards fit a %i-column transcript", async (width) => {
  const trace = stub(traceSpansFixture);
  const profile = stub(sampledProfileFixture);
  const h = await renderHarness(
    <box style={{ flexDirection: "column" }}>
      <SeerBlockEmbed
        name="trace"
        data={{ traceId: "trace", spanId: "cache" }}
        width={width}
        client={trace.client}
        org="acme"
      />
      <SeerBlockEmbed
        name="profile"
        data={{ profileId: "profile", projectSlug: "checkout" }}
        width={width}
        client={profile.client}
        org="acme"
      />
    </box>,
    { width, height: 28 },
  );
  try {
    await h.waitForFrame((frame) => frame.includes("json_decode"));
    expect(h.frame()).toContain("1000.00ms");
    expect(h.frame()).toContain("20.00ms");
    expect(h.frame()).toContain("› 100.00ms");
    expect(h.frame()).not.toContain("Loading");
  } finally {
    await h.cleanup();
  }
});

test("cards explain empty results, missing addresses, and HTTP failures", async () => {
  const empty = stub([]);
  const failed = stub({ detail: "Profile expired" }, 404);
  const h = await renderHarness(
    <box style={{ flexDirection: "column" }}>
      <SeerBlockEmbed
        name="trace"
        data={{ traceId: "empty" }}
        width={90}
        client={empty.client}
        org="acme"
      />
      <SeerBlockEmbed
        name="profile"
        data={{ profileId: "expired", projectSlug: "checkout" }}
        width={90}
        client={failed.client}
        org="acme"
      />
      <SeerBlockEmbed
        name="profile"
        data={{ profileId: "missing-project" }}
        width={90}
        client={failed.client}
        org="acme"
      />
    </box>,
    { width: 90, height: 24 },
  );
  try {
    await h.waitForFrame((frame) => frame.includes("Could not load profile frames"));
    expect(h.frame()).toContain("No trace spans found.");
    expect(h.frame()).toContain("Profile ID and project required.");
    expect(failed.requests).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});

test.each(["trace", "profile"])(
  "%s reference changes abort pending requests and ignore late responses",
  async (name) => {
    const requests: Array<{ signal?: AbortSignal | null; resolve: (response: Response) => void }> =
      [];
    const client = new SentryClient({
      auth: createTokenAuthProvider({ token: "test" }),
      maxRetries: 0,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          requests.push({ signal: init?.signal, resolve });
        })) as typeof fetch,
    });
    let change: (id: string) => void = () => {};
    /** Replace one transcript reference while its request is in flight. */
    function Probe() {
      const [id, setId] = useState("first");
      change = setId;
      return (
        <SeerBlockEmbed
          name={name}
          data={{ traceId: id, profileId: id, projectSlug: "checkout" }}
          width={90}
          client={client}
          org="acme"
        />
      );
    }
    const h = await renderHarness(<Probe />);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    try {
      expect(h.frame()).toContain(`Loading ${name}`);
      await act(async () => change("second"));
      await h.flush();
      expect(requests[0]!.signal?.aborted).toBe(true);
      await act(async () =>
        requests[0]!.resolve(json(name === "trace" ? traceSpansFixture : sampledProfileFixture)),
      );
      await h.flush();
      expect(h.frame()).not.toContain("GET /checkout");
      expect(h.frame()).not.toContain("json_decode");
      await act(async () =>
        requests[1]!.resolve(
          json(name === "trace" ? [] : { profile: { frames: [], stacks: [], samples: [] } }),
        ),
      );
      await h.flush();
      expect(h.frame()).toContain(
        name === "trace" ? "No trace spans found." : "No profile frames found.",
      );
      await act(async () => change("third"));
      await h.flush();
    } finally {
      await h.cleanup();
    }
    expect(requests.at(-1)!.signal?.aborted).toBe(true);
  },
);

test("trace preview stays bounded while keeping a short referenced span visible", async () => {
  const spans = Array.from({ length: 8 }, (_, i) => ({
    event_type: "span",
    event_id: `span-${i}`,
    name: `operation-${i}`,
    start_timestamp: 0,
    end_timestamp: 8 - i,
  }));
  const { client } = stub(spans);
  const h = await renderHarness(
    <SeerBlockEmbed
      name="trace"
      data={{ traceId: "trace", spanId: "span-7" }}
      width={100}
      client={client}
      org="acme"
    />,
  );
  try {
    await h.waitForFrame((frame) => frame.includes("operation-7"));
    expect(h.frame()).toContain("5/8 returned");
    expect(h.frame()).toContain("operation-0");
    expect(h.frame()).not.toContain("operation-4");
    expect(h.frame()).toContain("› 1000.00ms");
  } finally {
    await h.cleanup();
  }
});
