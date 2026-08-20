/**
 * The command catalog: one declaration per user-invokable action.
 *
 * This is the single source of truth for key dispatch, status-bar hints, and
 * the `?` help overlay. Help rows name command ids rather than literal keys, so
 * a rebind updates help automatically and an unbound command's row disappears
 * instead of advertising a dead key.
 */

export type CommandCategory = "app" | "nav" | "issue" | "view";

export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  /** Key chords, in canonical form. First one is shown in hints. */
  defaultKeys: readonly string[];
  /** Longer explanation for the help overlay. */
  description?: string;
}

export const COMMANDS: readonly Command[] = [
  // app
  {
    id: "sentry.app.quit",
    title: "Quit",
    category: "app",
    defaultKeys: ["q"],
  },
  {
    id: "sentry.app.help",
    title: "Help",
    category: "app",
    defaultKeys: ["?"],
    description: "Toggle this help overlay",
  },
  {
    id: "sentry.app.refresh",
    title: "Refresh",
    category: "app",
    defaultKeys: ["R"],
    description: "Reload the current view from the API",
  },
  {
    id: "sentry.app.focusNext",
    title: "Next pane",
    category: "app",
    defaultKeys: ["tab"],
  },
  {
    id: "sentry.app.focusPrev",
    title: "Previous pane",
    category: "app",
    defaultKeys: ["shift+tab"],
  },

  // nav
  {
    id: "sentry.nav.down",
    title: "Move down",
    category: "nav",
    defaultKeys: ["j", "down"],
  },
  {
    id: "sentry.nav.up",
    title: "Move up",
    category: "nav",
    defaultKeys: ["k", "up"],
  },
  {
    id: "sentry.nav.top",
    title: "Jump to top",
    category: "nav",
    defaultKeys: ["g", "home"],
  },
  {
    id: "sentry.nav.bottom",
    title: "Jump to bottom",
    category: "nav",
    defaultKeys: ["G", "end"],
  },
  {
    id: "sentry.nav.pageDown",
    title: "Page down",
    category: "nav",
    defaultKeys: ["pagedown", "ctrl+d"],
  },
  {
    id: "sentry.nav.pageUp",
    title: "Page up",
    category: "nav",
    defaultKeys: ["pageup", "ctrl+u"],
  },
  {
    id: "sentry.nav.open",
    title: "Open issue",
    category: "nav",
    defaultKeys: ["return"],
  },
  {
    id: "sentry.nav.back",
    title: "Back",
    category: "nav",
    defaultKeys: ["escape"],
  },
  {
    id: "sentry.nav.search",
    title: "Search",
    category: "nav",
    defaultKeys: ["/"],
    description: "Focus the issue search query",
  },

  // issue actions
  {
    id: "sentry.issue.resolve",
    title: "Resolve",
    category: "issue",
    defaultKeys: ["r"],
  },
  {
    id: "sentry.issue.archive",
    title: "Archive",
    category: "issue",
    defaultKeys: ["a"],
    description: "Archive until the issue escalates",
  },
  {
    id: "sentry.issue.unresolve",
    title: "Unresolve",
    category: "issue",
    defaultKeys: ["u"],
  },
  {
    id: "sentry.issue.bookmark",
    title: "Bookmark",
    category: "issue",
    defaultKeys: ["b"],
  },
  {
    id: "sentry.issue.markReviewed",
    title: "Mark reviewed",
    category: "issue",
    defaultKeys: ["m"],
  },
  {
    id: "sentry.issue.assign",
    title: "Assign",
    category: "issue",
    defaultKeys: ["A"],
  },
  {
    id: "sentry.issue.priority",
    title: "Set priority",
    category: "issue",
    defaultKeys: ["p"],
  },
] as const;

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): Command | undefined {
  return BY_ID.get(id);
}

/** Primary key chord for a command, for status-bar hints. */
export function primaryKey(id: string): string {
  return getCommand(id)?.defaultKeys[0] ?? "";
}

/** Human label for a chord, e.g. `return` -> `enter`. */
export function formatKey(chord: string): string {
  const labels: Record<string, string> = {
    return: "enter",
    escape: "esc",
    pagedown: "pgdn",
    pageup: "pgup",
    down: "↓",
    up: "↑",
  };
  return labels[chord] ?? chord;
}

/** Does this key event match any chord bound to `id`? */
export function matchesCommand(
  id: string,
  key: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean },
): boolean {
  const command = getCommand(id);
  if (!command) return false;
  return command.defaultKeys.some((chord) => matchesChord(chord, key));
}

function matchesChord(
  chord: string,
  key: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean },
): boolean {
  const parts = chord.split("+");
  const name = parts[parts.length - 1]!;
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantMeta = parts.includes("meta");

  if (Boolean(key.ctrl) !== wantCtrl) return false;
  if (Boolean(key.meta) !== wantMeta) return false;

  // Case carries meaning for single letters: "G" means shift+g, and a bare "g"
  // must *not* match shift+g — otherwise "jump to top" would swallow "jump to
  // bottom", since it is declared first.
  const isLetter = name.length === 1 && /[a-zA-Z]/.test(name);
  if (isLetter) {
    const needsShift = wantShift || name === name.toUpperCase();
    return key.name.toLowerCase() === name.toLowerCase() && Boolean(key.shift) === needsShift;
  }

  if (Boolean(key.shift) !== wantShift) return false;
  return key.name === name;
}
