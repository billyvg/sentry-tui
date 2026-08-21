/**
 * The command catalog: one declaration per user-invokable action.
 *
 * This is the single source of truth for key dispatch, status-bar hints, and
 * the `?` help overlay. Help rows name command ids rather than literal keys, so
 * a rebind updates help automatically and an unbound command's row disappears
 * instead of advertising a dead key.
 */

export type CommandCategory = "app" | "nav" | "issue" | "view" | "seer";

/**
 * When the command palette offers a command.
 *
 * A command with no scope is never listed — that covers everything the palette
 * can't meaningfully invoke (cursor movement, pane focus) as well as anything
 * still unimplemented, so the palette can't advertise a dead action.
 */
export type PaletteScope =
  /** No context needed. */
  | "always"
  /** Only on the issue or log stream — search and the filter selectors. */
  | "stream"
  /** Only with an issue selected or open — the triage actions. */
  | "issue";

export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  /** Key chords, in canonical form. First one is shown in hints. */
  defaultKeys: readonly string[];
  /** Longer explanation for the help overlay. */
  description?: string;
  /** When the command palette lists this command. Absent means never. */
  palette?: PaletteScope;
}

export const COMMANDS: readonly Command[] = [
  // app
  {
    id: "sentry.app.quit",
    title: "Quit",
    category: "app",
    defaultKeys: ["q"],
    palette: "always",
  },
  {
    id: "sentry.app.help",
    title: "Help",
    category: "app",
    defaultKeys: ["?"],
    description: "Toggle this help overlay",
    palette: "always",
  },
  {
    // Deliberately not offered in the palette: the palette is the thing you
    // would be closing to run it.
    id: "sentry.app.commandPalette",
    title: "Command palette",
    category: "app",
    defaultKeys: ["ctrl+k", "meta+k"],
    description: "Search every command and destination",
  },
  {
    id: "sentry.app.refresh",
    title: "Refresh",
    category: "app",
    defaultKeys: ["ctrl+r", "R"],
    description: "Reload the current view from the API",
    palette: "always",
  },
  {
    id: "sentry.app.switchOrg",
    title: "Switch organization",
    category: "app",
    defaultKeys: ["o"],
    description: "Open the organization picker",
    palette: "always",
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
    // Not "Open issue": the same key opens a log's detail panel on the log
    // stream, and the help overlay prints this title verbatim.
    title: "Open",
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
    // `n` for navigation. Not `g`: that is the list's jump-to-top, and one
    // chord may only have one claimant — see `commands.test.ts`.
    id: "sentry.nav.goto",
    title: "Navigate",
    category: "nav",
    defaultKeys: ["n"],
    description: "Jump to a nav item by its printed key",
  },
  {
    id: "sentry.nav.search",
    title: "Search",
    category: "nav",
    defaultKeys: ["/"],
    // One key for "search what is in front of you": the stream's query box,
    // or the filter box inside an open picker.
    description: "Focus the search box for this list",
    palette: "stream",
  },

  // issue actions
  {
    id: "sentry.issue.resolve",
    title: "Resolve",
    category: "issue",
    defaultKeys: ["r"],
    palette: "issue",
  },
  {
    id: "sentry.issue.archive",
    title: "Archive",
    category: "issue",
    defaultKeys: ["a"],
    description: "Archive until the issue escalates",
    palette: "issue",
  },
  {
    id: "sentry.issue.unresolve",
    title: "Unresolve",
    category: "issue",
    defaultKeys: ["u"],
    palette: "issue",
  },
  {
    id: "sentry.issue.bookmark",
    title: "Bookmark",
    category: "issue",
    defaultKeys: ["b"],
    palette: "issue",
  },
  {
    id: "sentry.issue.markReviewed",
    title: "Mark reviewed",
    category: "issue",
    defaultKeys: ["m"],
    palette: "issue",
  },

  // seer
  {
    id: "sentry.seer.compose",
    title: "Ask Seer",
    category: "seer",
    defaultKeys: ["i"],
    description: "Focus the Seer composer",
  },
  {
    // Shifted because a bare `n` opens goto mode everywhere else, and a key
    // that navigates on five screens must not discard a conversation on this
    // one.
    id: "sentry.seer.newChat",
    title: "New chat",
    category: "seer",
    defaultKeys: ["N"],
    description: "Start a fresh Seer conversation",
  },
  {
    id: "sentry.seer.interrupt",
    title: "Interrupt Seer",
    category: "seer",
    defaultKeys: ["x"],
    description: "Ask Seer to stop the current turn",
  },

  // view / filter
  {
    id: "sentry.view.filterProject",
    title: "Filter by project",
    category: "view",
    defaultKeys: ["P"],
    description: "Open the project selector",
    palette: "stream",
  },
  {
    id: "sentry.view.filterEnv",
    title: "Filter by environment",
    category: "view",
    defaultKeys: ["E"],
    description: "Open the environment selector",
    palette: "stream",
  },
  {
    id: "sentry.view.filterDate",
    title: "Filter by date",
    category: "view",
    defaultKeys: ["D"],
    description: "Open the date range selector",
    palette: "stream",
  },
  {
    // Every section is bound at once rather than one command per section: the
    // number is printed in the section's own header, so the binding is read off
    // the screen instead of memorised.
    id: "sentry.view.toggleSection",
    title: "Fold section",
    category: "view",
    defaultKeys: ["1", "2", "3", "4", "5", "6"],
    description: "Fold the numbered section",
  },
  {
    id: "sentry.view.toggleAllSections",
    title: "Fold all sections",
    category: "view",
    defaultKeys: ["z"],
    description: "Fold or unfold every section at once",
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

const KEY_LABELS: Record<string, string> = {
  return: "enter",
  escape: "esc",
  pagedown: "pgdn",
  pageup: "pgup",
  down: "↓",
  up: "↑",
};

/** `meta` is what the terminal reports; `cmd` is what's printed on the key. */
const MODIFIER_LABELS: Record<string, string> = {
  meta: "cmd",
};

/** Human label for a chord, e.g. `return` -> `enter`, `meta+k` -> `cmd+k`. */
export function formatKey(chord: string): string {
  const parts = chord.split("+");
  const name = parts.pop()!;
  const modifiers = parts.map((part) => MODIFIER_LABELS[part] ?? part);
  return [...modifiers, KEY_LABELS[name] ?? name].join("+");
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
