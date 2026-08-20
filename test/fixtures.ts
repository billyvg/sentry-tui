import type { GroupSearchView } from "~/api/groupSearchViews";
import type { Group, OrgMember, SentryEvent, TimeseriesValue } from "~/api/types";

function stats24h(peak: number): TimeseriesValue[] {
  const base = 1_700_000_000;
  const shape = [0.1, 0.3, 0.2, 0.6, 1, 0.8, 0.4, 0.2];
  return shape.map((factor, i) => [base + i * 3600, Math.round(peak * factor)]);
}

export const groupFixture: Group = {
  id: "1",
  shortId: "PUMP-STATION-1",
  title: "TypeError: Cannot read properties of undefined (reading 'id')",
  culprit: "web/src/views/app.tsx in renderRoot",
  level: "error",
  status: "unresolved",
  substatus: "ongoing",
  priority: "high",
  count: "1428",
  userCount: 92,
  firstSeen: "2026-08-01T21:19:55Z",
  lastSeen: "2026-08-20T09:12:03Z",
  permalink: "https://sentry.io/organizations/acme/issues/1/",
  project: { id: "2", slug: "javascript", name: "Frontend", platform: "javascript" },
  isBookmarked: false,
  isSubscribed: true,
  hasSeen: false,
  isUnhandled: true,
  numComments: 3,
  logger: null,
  platform: "javascript",
  metadata: { type: "TypeError", value: "Cannot read properties of undefined" },
  assignedTo: null,
  stats: { "24h": stats24h(140) },
};

export const groupsFixture: Group[] = [
  groupFixture,
  {
    ...groupFixture,
    id: "2",
    shortId: "PUMP-STATION-2",
    title: "ValueError: invalid literal for int() with base 10",
    culprit: "api/views/checkout.py in post",
    level: "fatal",
    priority: "medium",
    count: "312",
    userCount: 41,
    hasSeen: true,
    isUnhandled: false,
    numComments: 0,
    platform: "python",
    project: { id: "3", slug: "backend", name: "Backend", platform: "python" },
    metadata: {
      type: "ValueError",
      value: "invalid literal for int() with base 10",
    },
    stats: { "24h": stats24h(60) },
  },
  {
    ...groupFixture,
    id: "3",
    shortId: "PUMP-STATION-3",
    title: "Slow database query on /api/orders",
    culprit: "api/orders",
    level: "warning",
    status: "ignored",
    substatus: "archived_until_escalating",
    priority: "low",
    count: "58",
    userCount: 7,
    hasSeen: true,
    isUnhandled: false,
    logger: "sentry.db",
    // A performance issue carries no exception metadata, so the row falls back
    // to the whole `title` — the other branch of `issueTitle`.
    metadata: undefined,
    stats: { "24h": stats24h(12) },
  },
];

/**
 * `/organizations/{org}/users/`, covering the three avatar cases the assignee
 * cell has to tell apart: an uploaded picture, a Gravatar, and an account that
 * never set one. Every entry carries an `avatarUrl` — that field is populated
 * regardless, which is exactly the trap the lookup has to avoid.
 */
export const membersFixture: OrgMember[] = [
  {
    id: "10",
    email: "ada@example.com",
    name: "Ada Lovelace",
    user: {
      id: "100",
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarUrl: "https://gravatar.com/avatar/ada?s=32&d=mm",
      avatar: {
        avatarType: "upload",
        avatarUuid: "aaaa1111",
        avatarUrl: "https://sentry.io/avatar/aaaa1111/",
      },
    },
  },
  {
    id: "11",
    email: "grace@example.com",
    name: "Grace Hopper",
    user: {
      id: "101",
      name: "Grace Hopper",
      email: "grace@example.com",
      avatarUrl: "https://gravatar.com/avatar/grace?s=32&d=mm",
      avatar: { avatarType: "gravatar", avatarUuid: null, avatarUrl: null },
    },
  },
  {
    id: "12",
    email: "alan@example.com",
    name: "Alan Turing",
    user: {
      id: "102",
      name: "Alan Turing",
      email: "alan@example.com",
      avatarUrl: "https://gravatar.com/avatar/alan?s=32&d=mm",
      avatar: { avatarType: "letter_avatar", avatarUuid: null, avatarUrl: null },
    },
  },
  // An invitation nobody has accepted yet — no account behind it at all.
  { id: "13", email: "pending@example.com", name: "pending@example.com", user: null },
];

export const eventFixture: SentryEvent = {
  id: "abc123",
  eventID: "abc123",
  groupID: "1",
  projectID: "2",
  title: groupFixture.title,
  message: "",
  culprit: groupFixture.culprit,
  location: "app.tsx:42",
  platform: "javascript",
  type: "error",
  size: 10_231,
  dateCreated: "2026-08-20T09:12:03Z",
  dateReceived: "2026-08-20T09:12:04Z",
  tags: [
    { key: "browser", value: "Chrome 141.0.0" },
    { key: "environment", value: "production" },
    { key: "level", value: "error" },
    { key: "handled", value: "no" },
  ],
  contexts: {
    browser: { name: "Chrome", version: "141.0.0", type: "browser" },
    os: { name: "macOS", version: "26.5.0", type: "os" },
  },
  packages: {},
  sdk: { name: "sentry.javascript.react", version: "10.4.0" },
  user: { id: "42", email: "jane@example.com", ip_address: "10.0.0.1" },
  entries: [
    {
      type: "exception",
      data: {
        excOmitted: null,
        hasSystemFrames: true,
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'id')",
            module: null,
            threadId: null,
            mechanism: { type: "generic", handled: false },
            rawStacktrace: null,
            stacktrace: {
              framesOmitted: null,
              hasSystemFrames: true,
              registers: null,
              frames: [
                {
                  filename: "node_modules/react-dom/client.js",
                  absPath: "https://app.example.com/static/react-dom.js",
                  module: "react-dom",
                  package: null,
                  function: "invokeGuardedCallback",
                  rawFunction: null,
                  symbol: null,
                  lineNo: 3891,
                  colNo: 12,
                  inApp: false,
                  platform: null,
                  context: [],
                  vars: null,
                },
                {
                  filename: "web/src/views/app.tsx",
                  absPath: "webpack:///web/src/views/app.tsx",
                  module: "views/app",
                  package: null,
                  function: "renderRoot",
                  rawFunction: null,
                  symbol: null,
                  lineNo: 42,
                  colNo: 13,
                  inApp: true,
                  platform: null,
                  context: [
                    [40, "export function renderRoot(props: Props) {"],
                    [41, "  const { user } = props;"],
                    [42, "  return <Header id={user.id} />;"],
                    [43, "}"],
                  ],
                  vars: { props: "{user: undefined}" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "breadcrumbs",
      data: {
        values: [
          {
            type: "http",
            level: "info",
            category: "fetch",
            message: null,
            timestamp: "2026-08-20T09:12:01Z",
            data: { url: "/api/user", method: "GET", status_code: 200 },
          },
          {
            type: "navigation",
            level: "info",
            category: "navigation",
            message: "/orders -> /checkout",
            timestamp: "2026-08-20T09:12:02Z",
            data: null,
          },
        ],
      },
    },
    {
      type: "request",
      data: {
        url: "https://app.example.com/checkout",
        method: "GET",
        query: [["step", "2"]],
        headers: [["User-Agent", "Mozilla/5.0"]],
        cookies: [],
        data: null,
        fragment: null,
      },
    },
  ],
  nextEventID: null,
  previousEventID: null,
};

/** Saved issue views, as `/organizations/:org/group-search-views/` returns them. */
export const savedViewsFixture: {
  mine: GroupSearchView[];
  others: GroupSearchView[];
} = {
  mine: [
    {
      id: "10",
      name: "Prod errors",
      query: "is:unresolved level:error",
      querySort: "freq",
      // `-1` is Sentry's "all projects" sentinel, mixed in here so the screen's
      // handling of it is exercised alongside a real project id.
      projects: [42, -1],
      environments: ["production"],
      timeFilters: { start: null, end: null, period: "7d", utc: null },
      lastVisited: "2026-08-19T12:00:00Z",
      dateCreated: "2026-06-01T09:00:00Z",
      dateUpdated: "2026-08-01T09:00:00Z",
      starred: true,
      stars: 4,
      createdBy: { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
    },
  ],
  others: [
    {
      id: "11",
      name: "Team backlog",
      query: "is:unresolved assigned:#platform",
      querySort: "date",
      projects: [],
      environments: [],
      timeFilters: { period: "14d" },
      lastVisited: null,
      dateCreated: "2026-05-14T09:00:00Z",
      dateUpdated: "2026-05-14T09:00:00Z",
      starred: false,
      stars: 0,
      createdBy: { id: "2", name: "Grace Hopper", email: "grace@example.com" },
    },
  ],
};
