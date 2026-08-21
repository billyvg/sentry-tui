/**
 * Test fixtures for Session Replay.
 *
 * `rawReplaysFixture` matches what `/organizations/{org}/replays/` actually
 * returns — nested `user` / `os` / `browser` objects, snake-cased keys, and a
 * duration in seconds — so the normaliser in `~/api/replays` is exercised
 * rather than bypassed. `rawReplayErrorRowsFixture` is the flat Discover shape
 * the error list comes back in.
 */

/** One wire object from the replay index. Loose by design: so is the API. */
type RawReplay = Record<string, unknown>;

function makeReplay(id: string, overrides: Partial<Record<string, unknown>> = {}): RawReplay {
  const started = Date.parse("2026-08-20T14:03:11Z");
  return {
    id,
    project_id: "2",
    is_archived: false,
    has_viewed: false,
    user: {
      display_name: "Alice Nguyen",
      email: "alice@example.com",
      id: "42",
      ip: "203.0.113.7",
      username: "alice",
    },
    started_at: new Date(started).toISOString(),
    finished_at: new Date(started + 125_000).toISOString(),
    duration: 125,
    os: { name: "Mac OS X", version: "14.5" },
    browser: { name: "Chrome", version: "120.0.6099" },
    device: { name: null, brand: null, family: null, model_id: null },
    sdk: { name: "sentry.javascript.react", version: "8.2.0" },
    platform: "javascript",
    environment: "production",
    releases: ["frontend@1.4.2"],
    activity: 8,
    count_errors: 3,
    count_dead_clicks: 4,
    count_rage_clicks: 1,
    count_infos: 2,
    count_warnings: 0,
    count_urls: 6,
    count_segments: 12,
    error_ids: ["e1", "e2", "e3"],
    trace_ids: ["t1"],
    urls: ["https://acme.test/checkout"],
    tags: {},
    ...overrides,
  };
}

/**
 * Six replays: a busy one, a quiet one, an anonymous session, an already-read
 * one, a mobile session with no browser, and a deleted recording.
 */
export const rawReplaysFixture: RawReplay[] = [
  makeReplay("8a3f2c1d9e4b4f7a8c1d2e3f4a5b6c7d"),
  makeReplay("b17d4e5f6a7b8c9d0e1f2a3b4c5d6e7f", {
    user: { display_name: "Ben Okafor", email: "ben@example.com", id: "77" },
    duration: 4_215,
    activity: 2,
    count_errors: 0,
    count_dead_clicks: 0,
    count_rage_clicks: 0,
    browser: { name: "Firefox", version: "129.0" },
  }),
  makeReplay("c28e5f6a7b8c9d0e1f2a3b4c5d6e7f80", {
    user: { display_name: null, email: null, id: null, ip: null, username: null },
    activity: 5,
    count_errors: 1,
    count_rage_clicks: 6,
    // What Chrome-on-macOS really reports: a range, not a point version.
    os: { name: "Mac OS X", version: ">=10.15.7" },
  }),
  makeReplay("d39f6a7b8c9d0e1f2a3b4c5d6e7f8091", {
    has_viewed: true,
    user: { display_name: "Dana Reyes", email: "dana@example.com", id: "12" },
    os: { name: "Windows", version: "11" },
    browser: { name: "Edge", version: "127.0.2651" },
  }),
  makeReplay("e40a7b8c9d0e1f2a3b4c5d6e7f809123", {
    user: { display_name: "Ekene Mba", email: "ekene@example.com", id: "31" },
    os: { name: "Android", version: "14" },
    browser: { name: null, version: null },
    device: { name: "Pixel 8", brand: "Google", family: "Pixel", model_id: "GC3VE" },
    platform: "android",
    duration: 47,
    activity: 10,
  }),
  makeReplay("f51b8c9d0e1f2a3b4c5d6e7f80912345", {
    is_archived: true,
    user: { display_name: "Archived User", email: null, id: "Archived User" },
    duration: null,
    activity: null,
    count_errors: null,
    count_dead_clicks: null,
    count_rage_clicks: null,
    os: { name: null, version: null },
    browser: { name: null, version: null },
  }),
];

/** Flat Discover rows for the first replay's three errors. */
export const rawReplayErrorRowsFixture: Array<Record<string, unknown>> = [
  {
    id: "e1",
    title: "TypeError: Cannot read properties of undefined (reading 'total')",
    issue: "JAVASCRIPT-2A",
    level: "error",
    "project.name": "javascript",
    timestamp: "2026-08-20T14:03:19+00:00",
  },
  {
    id: "e2",
    title: "NetworkError: Failed to fetch /api/cart",
    issue: "JAVASCRIPT-2B",
    level: "error",
    "project.name": "javascript",
    timestamp: "2026-08-20T14:04:02+00:00",
  },
  {
    id: "e3",
    title: "Non-Error promise rejection captured",
    issue: "JAVASCRIPT-2C",
    level: "warning",
    "project.name": "javascript",
    timestamp: "2026-08-20T14:04:55+00:00",
  },
];

/** The org's projects, matching the `project_id` the replay fixtures carry. */
export const replayProjectsFixture = [
  { id: "2", slug: "javascript", name: "Frontend", platform: "javascript" },
];
