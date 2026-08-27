/**
 * Raw `/organizations/{org}/releases/` payloads, as the endpoint returns them.
 *
 * Deliberately untyped: these are wire shapes, not domain types, and the point
 * of the tests they feed is that `src/api/releases.ts` reshapes them correctly.
 * `null` appears where the serializer really sends it.
 */

/** Per-project health, keyed `${version}:${projectId}`. */
const HEALTH: Record<string, unknown> = {
  "frontend@1.4.2:2": {
    sessionsAdoption: 64.2,
    adoption: 61.0,
    crashFreeSessions: 99.982,
    crashFreeUsers: 99.94,
    sessionsCrashed: 4,
    totalSessions24h: 22_140,
  },
  "frontend@1.4.2:3": {
    sessionsAdoption: 12.5,
    adoption: 11.2,
    crashFreeSessions: 97.4,
    crashFreeUsers: 98.1,
    sessionsCrashed: 218,
    totalSessions24h: 8_400,
  },
  "frontend@1.4.1:2": {
    sessionsAdoption: 31.0,
    adoption: 29.8,
    crashFreeSessions: 99.301,
    crashFreeUsers: 99.5,
    sessionsCrashed: 61,
    totalSessions24h: 10_700,
  },
};

/** The list request: no `healthData` on any project. */
export const rawReleasesFixture: unknown[] = [
  {
    version: "frontend@1.4.2",
    shortVersion: "1.4.2",
    dateCreated: "2026-08-19T10:00:00Z",
    dateReleased: null,
    commitCount: 12,
    authors: [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }],
    versionInfo: { package: "frontend", version: { raw: "1.4.2" } },
    lastDeploy: { environment: "production", dateFinished: "2026-08-19T12:00:00Z" },
    projects: [
      { id: 2, slug: "javascript", name: "Frontend", platform: "javascript", newGroups: 12 },
      { id: 3, slug: "backend", name: "Backend", platform: "python", newGroups: 3 },
    ],
  },
  {
    version: "frontend@1.4.1",
    shortVersion: "1.4.1",
    dateCreated: "2026-08-17T08:30:00Z",
    dateReleased: "2026-08-17T09:00:00Z",
    commitCount: 1,
    authors: [{ name: "Ada Lovelace" }],
    versionInfo: { package: "frontend", version: { raw: "1.4.1" } },
    lastDeploy: null,
    projects: [
      { id: 2, slug: "javascript", name: "Frontend", platform: "javascript", newGroups: 0 },
    ],
  },
  {
    // Five projects and no commits: the card that has to collapse, and the
    // one whose meta line has nothing but a package to say.
    version: "mobile@8.2.0",
    shortVersion: "8.2.0",
    dateCreated: "2026-08-11T18:00:00Z",
    dateReleased: null,
    commitCount: 0,
    authors: [],
    versionInfo: { package: "com.acme.mobile", version: { raw: "8.2.0" } },
    lastDeploy: null,
    projects: [
      { id: 4, slug: "android", name: "Android", platform: "android", newGroups: 2 },
      { id: 5, slug: "ios", name: "iOS", platform: "apple-ios", newGroups: 1 },
      { id: 6, slug: "flutter-shell", name: "Flutter", platform: "flutter", newGroups: 0 },
      { id: 7, slug: "react-native", name: "RN", platform: "react-native", newGroups: 0 },
      { id: 8, slug: "watch", name: "Watch", platform: "apple-watch", newGroups: 0 },
    ],
  },
];

/**
 * The health request: the same releases with `healthData` attached.
 *
 * Derived from the list fixture rather than restated, so the two can't drift
 * into describing different pages. Projects missing from `HEALTH` get `null`,
 * which is what the serializer sends for a project with no sessions — the case
 * a card has to draw as unavailable rather than as zero.
 */
export const rawReleasesWithHealthFixture: unknown[] = rawReleasesFixture.map((release) => {
  const raw = release as { version: string; projects: Array<{ id: number }> };
  return {
    ...raw,
    projects: raw.projects.map((project) => ({
      ...project,
      hasHealthData: HEALTH[`${raw.version}:${project.id}`] !== undefined,
      healthData: HEALTH[`${raw.version}:${project.id}`] ?? null,
    })),
  };
});

const ADOPTION_INTERVALS = Array.from({ length: 24 }, (_, hour) =>
  new Date(Date.UTC(2026, 7, 19, hour)).toISOString(),
);

/** `/sessions/` grouped by project and release for the 24-hour mini chart. */
export const rawReleaseAdoptionByReleaseFixture = {
  intervals: ADOPTION_INTERVALS,
  groups: [
    {
      by: { project: 2, release: "frontend@1.4.2" },
      series: {
        "sum(session)": Array.from({ length: 24 }, (_, hour) => 12 + (hour % 6) * 7),
      },
    },
    {
      by: { project: 3, release: "frontend@1.4.2" },
      series: {
        "sum(session)": Array.from({ length: 24 }, (_, hour) => 5 + (hour % 4) * 3),
      },
    },
    {
      by: { project: 2, release: "frontend@1.4.1" },
      series: {
        "sum(session)": Array.from({ length: 24 }, (_, hour) => 18 - (hour % 6) * 2),
      },
    },
  ],
};

/** `/sessions/` grouped by project for the mini chart's shared baseline. */
export const rawReleaseAdoptionByProjectFixture = {
  intervals: ADOPTION_INTERVALS,
  groups: [
    {
      by: { project: 2 },
      series: {
        "sum(session)": Array.from({ length: 24 }, (_, hour) => 80 + (hour % 6) * 20),
      },
    },
    {
      by: { project: 3 },
      series: {
        "sum(session)": Array.from({ length: 24 }, (_, hour) => 35 + (hour % 4) * 10),
      },
    },
  ],
};
