/**
 * Sentry's primary navigation, mirroring
 * `sentry/static/app/views/navigation/navigation.tsx`.
 *
 * Note Alerts and Releases are deliberately absent from the top level — a
 * recent IA change moved Alerts under Monitors and Releases under Explore.
 */

export type NavGroupId = "issues" | "explore" | "dashboards" | "seer" | "monitors";

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
    glyph: "S",
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
];

export function getNavGroup(id: NavGroupId): NavGroup {
  const group = NAV_GROUPS.find((g) => g.id === id);
  if (!group) throw new Error(`Unknown nav group: ${id}`);
  return group;
}

/** Every destination in a group, flattened across its sections. */
export function navItems(group: NavGroup): string[] {
  return group.sections.flatMap((s) => s.items);
}

/**
 * The one destination a group has, when it only has one.
 *
 * Such a group has nothing to choose between, so opening it on the rail goes
 * straight to the content pane — a secondary list holding a single row is a
 * keystroke that can only be answered one way. Derived from `sections` rather
 * than flagged per group, so it stays true as sections change.
 */
export function soleNavItem(group: NavGroup): string | undefined {
  const items = navItems(group);
  return items.length === 1 ? items[0] : undefined;
}
