/**
 * Raw `events/?dataset=profileFunctions` rows, flat as the endpoint returns
 * them. `sum()` and `p75()` are nanoseconds.
 */
export const rawProfileFunctionRowsFixture: unknown[] = [
  {
    project: "backend",
    fingerprint: "1a2b3c",
    package: "django/db/models",
    function: "QuerySet._fetch_all",
    "count()": 18_402,
    "sum()": 42_100_000_000,
    "p75()": 3_400_000,
  },
  {
    project: "backend",
    fingerprint: "4d5e6f",
    package: "sentry/utils",
    function: "json.loads_experimental",
    "count()": 9_120,
    "sum()": 8_600_000_000,
    "p75()": 910_000,
  },
  {
    project: "javascript",
    fingerprint: "7a8b9c",
    package: "react-dom",
    function: "commitRootImpl",
    "count()": 4_005,
    "sum()": 1_250_000_000,
    "p75()": 420_000,
  },
  {
    // No package and a sub-microsecond p75 — the row that exercises both the
    // empty-string field and the smallest duration unit.
    project: "javascript",
    fingerprint: "0d1e2f",
    package: "",
    function: "anonymous",
    "count()": 512,
    "sum()": 240_000,
    "p75()": 380,
  },
];
