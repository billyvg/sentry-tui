import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { fetchDetector } from "~/api/detectors";
import { fetchReplay } from "~/api/replays";
import { detectorListFixture } from "./monitor-fixtures";
import { rawReplaysFixture } from "./replay-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });

test("fetchReplay resolves the organization replay-detail endpoint", async () => {
  const seen: string[] = [];
  const client = new SentryClient({
    auth,
    fetchImpl: (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ data: rawReplaysFixture[0] }), { status: 200 });
    }) as unknown as typeof fetch,
  });

  const replay = await fetchReplay(client, { org: "acme", replayId: "replay-1" });
  expect(replay.id).toBe("8a3f2c1d9e4b4f7a8c1d2e3f4a5b6c7d");
  expect(new URL(seen[0]!).pathname).toBe("/api/0/organizations/acme/replays/replay-1/");
});

test("fetchDetector resolves the detector-detail endpoint", async () => {
  const seen: string[] = [];
  const client = new SentryClient({
    auth,
    fetchImpl: (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify(detectorListFixture[0]), { status: 200 });
    }) as unknown as typeof fetch,
  });

  const detector = await fetchDetector(client, { org: "acme", detectorId: "1" });
  expect(detector.id).toBe("1");
  expect(new URL(seen[0]!).pathname).toBe("/api/0/organizations/acme/detectors/1/");
});
