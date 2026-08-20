/**
 * The command palette's catalog and ranking, as pure data.
 *
 * Nothing here is declared by hand: destinations come from `nav.ts` and
 * commands from `commands.ts`, so a new nav section or a new binding shows up
 * in `ctrl+k` without a second edit. Mirrors the web palette
 * (`sentry/static/app/components/commandPalette/`), down to the fzf scoring.
 */

import { COMMANDS, formatKey, primaryKey, type PaletteScope } from "~/core/commands";
import { NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { fuzzyMatch } from "~/lib/fuzzy";

/** Result headings, in the order they appear when nothing outranks them. */
export const PALETTE_SECTIONS = ["Go to", "Issue", "Commands"] as const;
export type PaletteSection = (typeof PALETTE_SECTIONS)[number];

export type PaletteTarget =
  | { kind: "nav"; group: NavGroupId; item: string }
  | { kind: "command"; commandId: string };

export interface PaletteAction {
  /** Unique within a catalog — the React key and the test handle. */
  id: string;
  section: PaletteSection;
  label: string;
  /** Trailing context: the owning nav group, or the command's key chord. */
  detail?: string;
  /** Extra match terms that never get printed. */
  keywords?: readonly string[];
  target: PaletteTarget;
}

/** What the app can currently act on, which decides what the palette offers. */
export interface PaletteContext {
  /** The issue or log stream is on screen — search and the filters apply. */
  streamView: boolean;
  /** An issue is selected or open — the triage actions apply. */
  hasIssue: boolean;
}

export interface PaletteResult {
  action: PaletteAction;
  score: number;
  /** Indices into `action.label` that matched, for highlighting. */
  positions: readonly number[];
}

export interface PaletteGroup {
  section: PaletteSection;
  results: readonly PaletteResult[];
  /** Matches the limit cut from this section. */
  hidden: number;
}

/**
 * One printed line: a heading, a selectable result and its cursor index, or
 * the tally of what a section's limit cut.
 */
export type PaletteRow =
  | { kind: "heading"; section: PaletteSection }
  | { kind: "result"; result: PaletteResult; index: number }
  | { kind: "more"; section: PaletteSection; count: number };

/**
 * Results a section shows while filtering, mirroring the web palette's
 * per-group `limit`.
 *
 * Without a cap, forty destinations that all match weakly push a section
 * holding the one strong match off the bottom of the frame — the section
 * ordering is by best score, but you still have to scroll past the loser.
 */
export const SECTION_LIMIT = 6;

function isInScope(scope: PaletteScope, context: PaletteContext): boolean {
  switch (scope) {
    case "always":
      return true;
    case "stream":
      return context.streamView;
    case "issue":
      return context.hasIssue;
  }
}

/**
 * Every action the palette can offer right now, in catalog order.
 *
 * Destinations come first because they are what the palette is mostly used
 * for; a query reorders the sections anyway.
 */
export function buildPaletteActions(context: PaletteContext): PaletteAction[] {
  const actions: PaletteAction[] = [];

  for (const group of NAV_GROUPS) {
    for (const section of group.sections) {
      for (const item of section.items) {
        // Labels repeat across groups ("Errors" is both an Explore view and a
        // Monitors type), so the group qualifies both the id and the display.
        actions.push({
          id: `nav:${group.id}:${item}`,
          section: "Go to",
          label: item,
          detail: group.label,
          keywords: section.title ? [group.label, section.title] : [group.label],
          target: { kind: "nav", group: group.id, item },
        });
      }
    }
  }

  for (const command of COMMANDS) {
    if (!command.palette || !isInScope(command.palette, context)) continue;
    const chord = primaryKey(command.id);
    actions.push({
      id: `command:${command.id}`,
      section: command.category === "issue" ? "Issue" : "Commands",
      label: command.title,
      detail: chord ? formatKey(chord) : undefined,
      keywords: command.description ? [command.description] : undefined,
      target: { kind: "command", commandId: command.id },
    });
  }

  return actions;
}

/**
 * Score and filter the catalog.
 *
 * An action matches on its label or any keyword and keeps the better score,
 * but only a label match highlights — the label is the one the list draws in
 * full. `detail` is deliberately not a match surface: it holds one-character
 * key chords, and an exact single-character hit outscores every real label
 * match, so typing the first letter of a word would jump to a binding.
 */
export function filterPaletteActions(
  actions: readonly PaletteAction[],
  query: string,
): PaletteResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return actions.map((action) => ({ action, score: 0, positions: [] }));
  }

  const results: PaletteResult[] = [];
  for (const action of actions) {
    const onLabel = fuzzyMatch(action.label, needle);
    let best = onLabel?.score ?? -Infinity;
    for (const keyword of action.keywords ?? []) {
      const match = fuzzyMatch(keyword, needle);
      if (match && match.score > best) best = match.score;
    }
    if (best === -Infinity) continue;
    results.push({ action, score: best, positions: onLabel?.positions ?? [] });
  }

  // Sort is stable in every engine this runs on, so equal scores keep catalog
  // order rather than shuffling as the user types.
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Bucket results under their section headings.
 *
 * Sections are ordered by their best result, so typing "resolve" floats the
 * issue actions above the destinations instead of burying them under a
 * fixed-order list of forty nav items.
 *
 * @param limit results per section, or `undefined` to keep them all — which
 *   is what an empty query wants, since browsing the whole catalog is the
 *   point of opening the palette and typing nothing.
 */
export function groupPaletteResults(
  results: readonly PaletteResult[],
  limit?: number,
): PaletteGroup[] {
  const bySection = new Map<PaletteSection, PaletteResult[]>();
  for (const result of results) {
    const bucket = bySection.get(result.action.section);
    if (bucket) bucket.push(result);
    else bySection.set(result.action.section, [result]);
  }

  return Array.from(bySection, ([section, sectionResults]) => ({
    section,
    results: limit === undefined ? sectionResults : sectionResults.slice(0, limit),
    hidden: limit === undefined ? 0 : Math.max(0, sectionResults.length - limit),
  })).sort(
    (a, b) =>
      bestScore(b.results) - bestScore(a.results) ||
      // With no query every score is 0, so the declared order decides — the
      // catalog's own order would interleave by command id instead.
      PALETTE_SECTIONS.indexOf(a.section) - PALETTE_SECTIONS.indexOf(b.section),
  );
}

function bestScore(results: readonly PaletteResult[]): number {
  return results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
}

/**
 * Flatten groups into printable rows, numbering the selectable ones.
 *
 * The cursor indexes results, not rows, so it can never land on a heading; the
 * `index` carried here is how a row knows whether it is the cursor.
 */
export function flattenPaletteRows(groups: readonly PaletteGroup[]): PaletteRow[] {
  const rows: PaletteRow[] = [];
  let index = 0;
  for (const group of groups) {
    rows.push({ kind: "heading", section: group.section });
    for (const result of group.results) {
      rows.push({ kind: "result", result, index });
      index++;
    }
    if (group.hidden > 0) {
      rows.push({ kind: "more", section: group.section, count: group.hidden });
    }
  }
  return rows;
}

/** The row a given cursor position lands on, for scrolling it into view. */
export function rowIndexOfResult(rows: readonly PaletteRow[], cursor: number): number {
  return rows.findIndex((row) => row.kind === "result" && row.index === cursor);
}
