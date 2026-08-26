/**
 * Explore's query builder, as a row of chips.
 *
 * The web puts Visualize, Group By and Sort By in a sidebar beside the Traces
 * table, one labelled section each (`views/explore/toolbar/`). A terminal has
 * no column to spare for that, so the same four controls become a second chip
 * row under the filters — the same pill, the same printed key, the same
 * dropdown as the project selector, because they are the same kind of thing:
 * something you press to change what the table is showing.
 *
 * The section labels are the part that gets dropped when the pane is narrow.
 * They name what the chips already show — a chip reading `p95` beside one
 * reading `span.duration` is legible without the word "Visualize" over it —
 * and the row is clipped rather than wrapped, exactly as the filter row above
 * it is.
 *
 * Sort direction is a chip that acts rather than one that opens: it has two
 * states, and a two-row menu to pick between them would cost three keystrokes
 * where one will do.
 */

import { useMemo } from "react";

import type { TraceItemAttribute } from "~/api/traceItemAttributes";
import {
  argumentKind,
  argumentLabel,
  availableExploreAggregates,
  effectiveSort,
  groupByLabel,
  isScoreAttribute,
  sortOptions,
  withAggregate,
  withArgument,
  withGroupBys,
  withSort,
  withToggledDirection,
  DISALLOWED_GROUP_BYS,
  type ExploreQueryState,
} from "~/core/exploreQuery";
import type { ExploreTable } from "~/core/exploreTables";
import { useTheme } from "~/ui/theme";
import { measureTextWidth } from "~/lib/text";
import { Chip, CHIP_GAP, CHIP_HEIGHT, chipWidth, type ChipSpec } from "~/ui/components/Chip";
import { Dropdown, type DropdownItem } from "~/ui/components/Dropdown";
import type { TraceItemAttributes } from "~/ui/hooks/useTraceItemAttributes";

/** Which of the builder's menus is open, if any. */
export type ExploreQueryDropdown = "visualize" | "field" | "groupBy" | "sort" | "interval" | null;

/** Rows the builder row occupies — one chip's worth, like the filter row. */
export const QUERY_BAR_ROWS = CHIP_HEIGHT;

/** Cells between a section label and the chip it names. */
const LABEL_GAP = 1;
/** Cells before a section label, to read as a break rather than a run. */
const SECTION_GAP = 3;

/** The value the group-by list uses for "don't group" — the web's `UNGROUPED`. */
const UNGROUPED = "";

/**
 * Widest an attribute menu may grow.
 *
 * The list is the org's own attribute keys, and one `_pi_file_io_main_thread_fp`
 * would otherwise set the width for a menu of `span.op`s. Wide enough for the
 * keys a reader is actually looking for; the rest are found by typing.
 */
const ATTRIBUTE_MENU_WIDTH = 44;

export interface ExploreQueryBarProps {
  table: ExploreTable;
  query: ExploreQueryState;
  /** Attribute keys the org actually has, for the two attribute menus. */
  attributes: TraceItemAttributes;
  /** Which menu is open. Owned by the screen, so its keys and clicks agree. */
  open: ExploreQueryDropdown;
  /** Cells the row has, so the section labels can be dropped when they don't fit. */
  width: number;
  /** Row the builder starts on, for anchoring a menu below its chip. */
  anchorTop: number;
  /** Bucket width selected for the chart above the table. */
  interval: string;
  /** Widths valid for the current date range. */
  intervalItems: readonly DropdownItem[];
  onChange: (next: ExploreQueryState) => void;
  onIntervalChange: (interval: string) => void;
  onOpen: (which: ExploreQueryDropdown) => void;
  onClose: () => void;
}

/** One cell of the row: a chip that opens or acts, or a label naming a group. */
type RowItem =
  | { kind: "label"; text: string; gapBefore: number }
  | {
      kind: "chip";
      chip: ChipSpec;
      gapBefore: number;
      /** The menu this chip opens, or `null` for one that acts immediately. */
      opens: ExploreQueryDropdown;
      onPress: () => void;
    };

export function ExploreQueryBar({
  table,
  query,
  attributes,
  open,
  width,
  anchorTop,
  interval,
  intervalItems,
  onChange,
  onIntervalChange,
  onOpen,
  onClose,
}: ExploreQueryBarProps) {
  const theme = useTheme();
  const sort = effectiveSort(query, table);
  const kind = argumentKind(query.aggregate);
  // `count` and the no-argument aggregates have exactly one field between
  // them, so the chip states it and doesn't pretend to be a menu.
  const fieldIsChoosable = kind !== "none" && kind !== "count";
  const numberFields = useMemo(() => attributes.number.map(({ key }) => key), [attributes.number]);
  const aggregateItems = useMemo(
    () =>
      availableExploreAggregates(table, numberFields).map(({ name }) => ({
        label: name,
        value: name,
      })),
    [table, numberFields],
  );

  const items: RowItem[] = [
    { kind: "label", text: "Visualize", gapBefore: 0 },
    {
      kind: "chip",
      gapBefore: LABEL_GAP,
      opens: "visualize",
      onPress: () => onOpen("visualize"),
      chip: { command: "sentry.explore.visualize", label: query.aggregate, caret: true },
    },
    {
      kind: "chip",
      gapBefore: CHIP_GAP,
      opens: "field",
      onPress: () => fieldIsChoosable && onOpen("field"),
      chip: {
        command: "sentry.explore.visualizeField",
        label: argumentLabel(query, table),
        caret: fieldIsChoosable,
      },
    },
    { kind: "label", text: "Group by", gapBefore: SECTION_GAP },
    {
      kind: "chip",
      gapBefore: LABEL_GAP,
      opens: "groupBy",
      onPress: () => onOpen("groupBy"),
      chip: { command: "sentry.explore.groupBy", label: groupByLabel(query), caret: true },
    },
    { kind: "label", text: "Sort", gapBefore: SECTION_GAP },
    {
      kind: "chip",
      gapBefore: LABEL_GAP,
      opens: "sort",
      onPress: () => onOpen("sort"),
      chip: { command: "sentry.view.sort", label: sort.field, caret: true },
    },
    {
      kind: "chip",
      gapBefore: CHIP_GAP,
      opens: null,
      onPress: () => onChange(withToggledDirection(query, table)),
      chip: {
        command: "sentry.explore.sortDirection",
        label: sort.direction === "desc" ? "Desc" : "Asc",
      },
    },
    { kind: "label", text: "Interval", gapBefore: SECTION_GAP },
    {
      kind: "chip",
      gapBefore: LABEL_GAP,
      opens: "interval",
      onPress: () => onOpen("interval"),
      chip: { command: "sentry.explore.interval", label: interval, caret: true },
    },
  ];

  const labelled = layout(items, true);
  const showLabels = labelled.total <= width;
  const { placed } = showLabels ? labelled : layout(items, false);

  const dropdownTop = anchorTop + CHIP_HEIGHT;
  const anchorOf = (which: Exclude<ExploreQueryDropdown, null>) =>
    placed.find((p) => p.item.kind === "chip" && p.item.opens === which)?.left ?? 0;

  return (
    <>
      <box
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          height: CHIP_HEIGHT,
          overflow: "hidden",
        }}
      >
        {placed.map(({ item, key, gap }) =>
          item.kind === "label" ? (
            <text key={key} fg={theme.muted}>{`${" ".repeat(gap)}${item.text}`}</text>
          ) : (
            <box key={key} style={{ flexDirection: "row", flexShrink: 0 }}>
              {gap > 0 ? <text>{" ".repeat(gap)}</text> : null}
              <Chip
                {...item.chip}
                active={open !== null && open === item.opens}
                onPress={item.onPress}
              />
            </box>
          ),
        )}
      </box>

      {open === "visualize" ? (
        <Dropdown
          title="Visualize"
          items={aggregateItems}
          selected={[query.aggregate]}
          anchorLeft={anchorOf("visualize")}
          anchorTop={dropdownTop}
          showAll={false}
          onSelect={(values) => {
            const value = values[0];
            if (value) onChange(withAggregate(query, value, table, numberFields));
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}

      {open === "field" ? (
        <FieldDropdown
          query={query}
          attributes={attributes}
          anchorLeft={anchorOf("field")}
          anchorTop={dropdownTop}
          onSelect={(value) => {
            onChange(withArgument(query, value));
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}

      {open === "groupBy" ? (
        <GroupByDropdown
          query={query}
          attributes={attributes}
          anchorLeft={anchorOf("groupBy")}
          anchorTop={dropdownTop}
          onSelect={(value) => {
            onChange(withGroupBys(query, toggleGroupBy(query.groupBys, value), table));
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}

      {open === "sort" ? (
        <Dropdown
          title="Sort By"
          items={sortOptions(query, table).map((field) => ({ label: field, value: field }))}
          selected={[sort.field]}
          anchorLeft={anchorOf("sort")}
          anchorTop={dropdownTop}
          showAll={false}
          placeholder="No sortable columns"
          onSelect={(values) => {
            const value = values[0];
            if (value) onChange(withSort(query, { field: value, direction: sort.direction }));
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}

      {open === "interval" ? (
        <Dropdown
          title="Chart Interval"
          items={intervalItems}
          selected={[interval]}
          anchorLeft={anchorOf("interval")}
          anchorTop={dropdownTop}
          showAll={false}
          placeholder="No intervals for this range"
          onSelect={(values) => {
            const value = values[0];
            if (value) onIntervalChange(value);
            onClose();
          }}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}

/**
 * The aggregate's argument.
 *
 * Which attributes are on offer is the aggregate's business —
 * `getSupportedAttributes` (`hooks/useVisualizeFields.tsx`): a numeric
 * aggregate reads numbers, `count_unique` reads anything, and the two score
 * functions read only the web vitals they are defined over.
 */
function FieldDropdown({
  query,
  attributes,
  anchorLeft,
  anchorTop,
  onSelect,
  onClose,
}: {
  query: ExploreQueryState;
  attributes: TraceItemAttributes;
  anchorLeft: number;
  anchorTop: number;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const kind = argumentKind(query.aggregate);
  const items = useMemo(() => {
    if (kind === "any") {
      return toItems([...attributes.string, ...attributes.number, ...attributes.boolean]);
    }
    if (kind === "score") return toItems(attributes.number.filter((a) => isScoreAttribute(a.key)));
    return toItems(attributes.number);
  }, [kind, attributes]);

  return (
    <Dropdown
      title="Field"
      items={items}
      selected={[query.argument]}
      anchorLeft={anchorLeft}
      anchorTop={anchorTop}
      showAll={false}
      filterable
      maxWidth={ATTRIBUTE_MENU_WIDTH}
      placeholder={attributes.loading ? "Loading attributes…" : "No attributes found"}
      onSelect={(values) => {
        const value = values[0];
        if (value) onSelect(value);
      }}
      onClose={onClose}
    />
  );
}

/**
 * The attributes to group by, with the web's own "—" at the top for none.
 *
 * Picking an attribute that is already grouped removes it, which is how a
 * single-select list stands in for the web's stack of "+ Add Group" rows: the
 * dots down the left say what is grouped, and pressing one twice undoes it.
 */
function GroupByDropdown({
  query,
  attributes,
  anchorLeft,
  anchorTop,
  onSelect,
  onClose,
}: {
  query: ExploreQueryState;
  attributes: TraceItemAttributes;
  anchorLeft: number;
  anchorTop: number;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const items = useMemo(
    () => [
      { label: "—", value: UNGROUPED },
      ...toItems(
        [...attributes.string, ...attributes.number, ...attributes.boolean].filter(
          (a) => !DISALLOWED_GROUP_BYS.has(a.key),
        ),
      ),
    ],
    [attributes.string, attributes.number, attributes.boolean],
  );

  return (
    <Dropdown
      title="Group By"
      items={items}
      selected={query.groupBys.length > 0 ? [...query.groupBys] : [UNGROUPED]}
      anchorLeft={anchorLeft}
      anchorTop={anchorTop}
      showAll={false}
      filterable
      maxWidth={ATTRIBUTE_MENU_WIDTH}
      placeholder={attributes.loading ? "Loading attributes…" : "No attributes found"}
      onSelect={(values) => onSelect(values[0] ?? UNGROUPED)}
      onClose={onClose}
    />
  );
}

/**
 * Attributes as dropdown rows, keyed rather than named.
 *
 * The key is what a query is written against and what the chip will show, and
 * a display name beside it would only make the list harder to scan — the same
 * call the project selector makes about slugs.
 */
function toItems(attributes: readonly TraceItemAttribute[]): DropdownItem[] {
  return [
    ...new Map(
      attributes.map((attribute) => [
        attribute.key,
        { label: attribute.key, value: attribute.key },
      ]),
    ).values(),
  ];
}

/** Add an attribute to the group-by list, or take it back out. */
function toggleGroupBy(groupBys: readonly string[], value: string): string[] {
  if (!value) return [];
  return groupBys.includes(value) ? groupBys.filter((key) => key !== value) : [...groupBys, value];
}

/** Where each item sits, and how wide the row is with or without its labels. */
function layout(items: readonly RowItem[], withLabels: boolean) {
  const placed: Array<{ item: RowItem; key: string; left: number; gap: number }> = [];
  let left = 0;
  let first = true;
  for (const item of items) {
    if (item.kind === "label" && !withLabels) continue;
    const gap = first ? 0 : item.gapBefore;
    first = false;
    const start = left + gap;
    placed.push({
      item,
      key: item.kind === "label" ? `label:${item.text}` : item.chip.command,
      left: start,
      gap,
    });
    left = start + (item.kind === "label" ? measureTextWidth(item.text) : chipWidth(item.chip));
  }
  return { placed, total: left };
}
