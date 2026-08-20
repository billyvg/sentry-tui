import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { matchesCommand } from "~/core/commands";
import {
  filterPaletteActions,
  flattenPaletteRows,
  groupPaletteResults,
  rowIndexOfResult,
  SECTION_LIMIT,
  type PaletteAction,
  type PaletteRow,
} from "~/core/palette";
import { theme } from "~/core/theme";
import { fitText } from "~/lib/text";
import { ModalFrame } from "~/ui/components/ModalFrame";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";
import { listWindowStart, resolveModalGeometry } from "~/ui/lib/modalGeometry";

export const PALETTE_WIDTH = 68;
/**
 * Tall enough that a capped, filtered list shows two whole sections and the
 * next heading, so the sections below the top one are visibly there rather
 * than discovered by scrolling. `ModalFrame` clamps it on a short terminal.
 */
export const PALETTE_HEIGHT = 24;
/**
 * Rows the frame spends on itself: border, padding, the query line, the blank
 * line under it, and the hint footer. `ModalFrame` clamps the frame to the
 * terminal, so the window size is derived from the same geometry it uses
 * rather than from the requested height.
 */
const PALETTE_CHROME = 7;
/** The `▸ ` / `  ` cursor gutter every row carries. */
const CURSOR_WIDTH = 2;
/** Blank columns between a label and its right-aligned detail. */
const DETAIL_GAP = 2;

export interface CommandPaletteProps {
  actions: readonly PaletteAction[];
  onRun: (action: PaletteAction) => void;
  onClose: () => void;
}

/**
 * `ctrl+k` — fuzzy search over every destination and command.
 *
 * The list is flat rather than drilled-into like the web palette's nested
 * groups: a terminal has no hover affordance to suggest a row expands, and
 * every destination is one fuzzy match away regardless.
 */
export function CommandPalette({ actions, onRun, onClose }: CommandPaletteProps) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const { results, rows } = useMemo(() => {
    const filtered = filterPaletteActions(actions, query);
    // Browsing wants the whole catalog; a query wants every section's best
    // few, so a strong match can't hide under a section full of weak ones.
    const groups = groupPaletteResults(filtered, query.trim() ? SECTION_LIMIT : undefined);
    const visible = groups.flatMap((group) => group.results);
    return { results: visible, rows: flattenPaletteRows(groups) };
  }, [actions, query]);

  // A new query reranks everything, so the old cursor position means nothing.
  useEffect(() => setCursor(0), [query]);

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        () => {
          if (matchesCommand("sentry.nav.back", key)) {
            onClose();
            return "mine";
          }
          // The opening chord also closes, so ctrl+k toggles rather than
          // typing a stray character into the query.
          if (matchesCommand("sentry.app.commandPalette", key)) {
            onClose();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            const action = results[cursor]?.action;
            if (action) onRun(action);
            return "mine";
          }
          // Arrows and the readline chords only — `j` and `k` are text here.
          if (isDown(key)) {
            setCursor((c) => Math.min(c + 1, results.length - 1));
            return "mine";
          }
          if (isUp(key)) {
            setCursor((c) => Math.max(c - 1, 0));
            return "mine";
          }
          // Everything else is typing: let the focused input have it.
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  const geo = resolveModalGeometry({
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    terminalWidth: termWidth,
    terminalHeight: termHeight,
  });
  const contentWidth = Math.max(1, geo.width - 4);
  const visibleRows = Math.max(1, geo.height - PALETTE_CHROME);
  const windowStart = listWindowStart(
    Math.max(0, rowIndexOfResult(rows, cursor)),
    rows.length,
    visibleRows,
  );

  return (
    <ModalFrame
      title=" Command palette "
      width={PALETTE_WIDTH}
      height={PALETTE_HEIGHT}
      onClose={onClose}
    >
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={theme.accent}>{"❯ "}</text>
        <input
          value={query}
          placeholder="Search commands and destinations…"
          focused
          onInput={setQuery}
          style={{
            flexGrow: 1,
            textColor: theme.text,
            backgroundColor: theme.panel,
            focusedTextColor: theme.text,
            focusedBackgroundColor: theme.panel,
            placeholderColor: theme.subText,
          }}
        />
      </box>

      <box style={{ flexGrow: 1, flexDirection: "column", marginTop: 1 }}>
        {rows.length === 0 ? (
          <text fg={theme.muted}>{fitText(`No matches for "${query}"`, contentWidth)}</text>
        ) : (
          rows.slice(windowStart, windowStart + visibleRows).map((row) => {
            if (row.kind === "heading") {
              return (
                <text key={`heading:${row.section}`} fg={theme.accent}>
                  {row.section}
                </text>
              );
            }
            if (row.kind === "more") {
              return (
                <text key={`more:${row.section}`} fg={theme.subText}>
                  {`  +${row.count} more — keep typing`}
                </text>
              );
            }
            return (
              <PaletteRowView
                key={row.result.action.id}
                row={row}
                selected={row.index === cursor}
                width={contentWidth}
                onPress={() => onRun(row.result.action)}
              />
            );
          })
        )}
      </box>

      <text fg={theme.muted}>↑↓ move · enter select · esc close</text>
    </ModalFrame>
  );
}

function PaletteRowView({
  row,
  selected,
  width,
  onPress,
}: {
  row: Extract<PaletteRow, { kind: "result" }>;
  selected: boolean;
  width: number;
  onPress: () => void;
}) {
  const { action, positions } = row.result;
  const detail = action.detail ?? "";
  const labelWidth = Math.max(1, width - CURSOR_WIDTH - (detail ? detail.length + DETAIL_GAP : 0));

  return (
    <box
      style={{
        flexDirection: "row",
        flexShrink: 0,
        backgroundColor: selected ? theme.selected : undefined,
      }}
      onMouseUp={onPress}
    >
      <text fg={theme.accent}>{selected ? "▸ " : "  "}</text>
      <HighlightedLabel
        text={action.label}
        positions={positions}
        width={labelWidth}
        fg={selected ? theme.text : theme.muted}
      />
      <box style={{ flexGrow: 1 }} />
      {detail ? <text fg={theme.subText}>{detail}</text> : null}
    </box>
  );
}

/**
 * Draw a label with its matched characters picked out in the accent colour.
 *
 * Positions are code-unit indices from `fuzzyMatch`, and truncation only ever
 * cuts a suffix, so indices still line up with the fitted string; anything the
 * ellipsis swallowed simply stops being highlighted.
 */
function HighlightedLabel({
  text,
  positions,
  width,
  fg,
}: {
  text: string;
  positions: readonly number[];
  width: number;
  fg: string;
}) {
  const fitted = fitText(text, width);
  const visible = fitted === text ? fitted.length : Math.max(0, fitted.length - 1);
  const matched = new Set(positions);

  const spans: ReactNode[] = [];
  let buffer = "";
  let bufferMatched = false;
  const flush = () => {
    if (!buffer) return;
    spans.push(
      <span key={spans.length} fg={bufferMatched ? theme.accent : fg}>
        {buffer}
      </span>,
    );
    buffer = "";
  };

  for (let i = 0; i < fitted.length; i++) {
    const isMatch = i < visible && matched.has(i);
    if (isMatch !== bufferMatched) {
      flush();
      bufferMatched = isMatch;
    }
    buffer += fitted[i];
  }
  flush();

  return <text>{spans}</text>;
}

function isDown(key: KeyEvent): boolean {
  return key.name === "down" || (key.name === "n" && Boolean(key.ctrl));
}

function isUp(key: KeyEvent): boolean {
  return key.name === "up" || (key.name === "p" && Boolean(key.ctrl));
}
