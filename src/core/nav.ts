/**
 * Sentry's primary navigation, mirroring
 * `sentry/static/app/views/navigation/navigation.tsx`.
 *
 * Note Alerts and Releases are deliberately absent from the top level — a
 * recent IA change moved Alerts under Monitors and Releases under Explore.
 */

export type NavGroupId = "issues" | "explore" | "dashboards" | "seer" | "monitors" | "settings";

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** Single-character glyph for the collapsed rail. */
  glyph: string;
  /** Secondary navigation entries, in the order the web app shows them. */
  sections: ReadonlyArray<{ title?: string; items: readonly string[] }>;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "issues",
    label: "Issues",
    glyph: "I",
    sections: [
      { items: ["Feed", "Inbox"] },
      {
        items: [
          "Errors & Outages",
          "Breached Metrics",
          "Warnings",
          "Configuration",
          "User Feedback",
        ],
      },
      { title: "Autofix", items: ["Recently Run"] },
      { items: ["All Views"] },
    ],
  },
  {
    id: "explore",
    label: "Explore",
    glyph: "E",
    sections: [
      {
        items: [
          "Traces",
          "Logs",
          "Metrics",
          "Errors",
          "Discover",
          "Profiles",
          "Replays",
          "Releases",
          "Conversations",
        ],
      },
      { items: ["All Queries"] },
    ],
  },
  {
    id: "dashboards",
    label: "Dashboards",
    glyph: "D",
    sections: [{ items: ["All Dashboards", "Sentry Built"] }],
  },
  {
    id: "seer",
    label: "Seer",
    glyph: "?",
    sections: [{ items: ["Ask Seer"] }],
  },
  {
    id: "monitors",
    label: "Monitors",
    glyph: "M",
    sections: [
      { items: ["All Monitors", "My Monitors"] },
      {
        title: "By Monitor Type",
        items: ["Error", "Metric", "Cron", "Uptime", "Mobile Build"],
      },
      { items: ["Alerts"] },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    glyph: "S",
    sections: [{ items: ["Organization", "Projects", "Teams"] }],
  },
];

export function getNavGroup(id: NavGroupId): NavGroup {
  const group = NAV_GROUPS.find((g) => g.id === id);
  if (!group) throw new Error(`Unknown nav group: ${id}`);
  return group;
}
