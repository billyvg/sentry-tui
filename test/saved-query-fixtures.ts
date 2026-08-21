/**
 * Saved-query API responses, exactly as the two endpoints return them.
 *
 * Kept raw rather than pre-normalised so the tests exercise
 * `src/api/savedQueries.ts` as well as the screens: the nested `query` array,
 * the `-1` all-projects sentinel, prebuilt queries with no creator, and the
 * legacy Discover shape are all things the normaliser has to get right.
 */

/** `GET /organizations/{org}/explore/saved/` — `ReadableSavedQuery[]`. */
export const rawExploreSavedQueriesFixture: unknown[] = [
  {
    id: 501,
    name: "Slow checkout spans",
    dataset: "spans",
    range: "24h",
    projects: [42],
    environment: ["production"],
    lastVisited: "2026-08-19T12:00:00Z",
    dateUpdated: "2026-08-18T12:00:00Z",
    starred: true,
    createdBy: { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
    query: [
      {
        fields: ["id", "span.description", "span.duration", "timestamp"],
        mode: "samples",
        orderby: "-span.duration",
        query: "span.op:http.client",
      },
    ],
  },
  {
    id: 502,
    name: "Billing errors",
    dataset: "logs",
    range: "7d",
    // The all-projects sentinel, mixed with a real id.
    projects: [-1, 42],
    environment: [],
    lastVisited: "2026-08-01T09:00:00Z",
    dateUpdated: "2026-07-30T09:00:00Z",
    starred: true,
    createdBy: { id: "2", name: "Grace Hopper", email: "grace@example.com" },
    query: [
      {
        fields: ["timestamp", "message", "project"],
        mode: "samples",
        orderby: "-timestamp",
        query: "severity:error",
      },
    ],
  },
  {
    id: 503,
    name: "Sentry p95 overview",
    dataset: "segment_spans",
    projects: [],
    environment: [],
    starred: false,
    isPrebuilt: true,
    query: [
      {
        fields: ["transaction", "p95(span.duration)"],
        mode: "aggregate",
        orderby: "-p95(span.duration)",
        query: "",
      },
    ],
  },
  // Dropped by the normaliser: no query object means nothing to run or show.
  { id: 504, name: "Empty", dataset: "spans", starred: false, query: [] },
];

/** `GET /organizations/{org}/discover/saved/` — the legacy `SavedQuery[]`. */
export const rawDiscoverSavedQueriesFixture: unknown[] = [
  {
    id: "900",
    name: "Unhandled by release",
    version: 2,
    queryDataset: "error-events",
    fields: ["title", "release", "count()"],
    // `orderby` is `string | string[]` on the wire; only the first sort is used.
    orderby: ["-count()", "title"],
    query: "error.unhandled:true",
    range: "14d",
    projects: [42],
    environment: [],
    dateCreated: "2026-02-01T09:00:00Z",
    dateUpdated: "2026-08-10T09:00:00Z",
    createdBy: { id: "3", name: "Alan Turing", email: "alan@example.com" },
  },
];

/** Rows `events/` returns for the "Slow checkout spans" query above. */
export const savedQueryResultRowsFixture = [
  {
    id: "aaaa1111bbbb2222",
    "span.description": "POST /api/checkout",
    "span.duration": 1843.5,
    timestamp: "2026-08-20T09:12:03+00:00",
  },
  {
    id: "cccc3333dddd4444",
    "span.description": "GET /api/cart",
    "span.duration": 212,
    timestamp: "2026-08-20T09:11:44+00:00",
  },
];
