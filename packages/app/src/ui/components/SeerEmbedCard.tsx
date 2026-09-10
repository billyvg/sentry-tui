/**
 * The frame every Seer block embed draws inside.
 *
 * The web embeds are each a bespoke widget; in a terminal the thing that makes
 * two dozen of them read as one family is that they agree on their chrome — a
 * bordered card, a labelled title, a dim line of filters under it. So the
 * chrome lives here once, and an embed contributes only what is specific to it.
 */

import type { ReactNode } from "react";

import { errorOf, isInitialLoad, type AsyncStatus } from "~/core/async";
import { fitText, wrapText } from "~/lib/text";
import { BODY_INDENT, Field } from "~/ui/components/DetailSections";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { useTheme } from "~/ui/theme";

/** Space the border and its padding take from the width an embed is given. */
export const CARD_CHROME = 3;

export interface SeerEmbedCardProps {
  /** What kind of thing this is — `Dashboard`, `Trace`, `Spans`. */
  label: string;
  /** The thing's own name, when it has one worth showing beside the label. */
  title?: string;
  /** The dim line under the title: filters, a period, a dataset. */
  subtitle?: string;
  width: number;
  /** Draw the border in the palette's alert color — used by write approvals. */
  tone?: "normal" | "accent" | "warning" | "danger";
  children?: ReactNode;
}

/** One embed's card: a titled, bordered box sized to the transcript's width. */
export function SeerEmbedCard({
  label,
  title,
  subtitle,
  width,
  tone = "normal",
  children,
}: SeerEmbedCardProps) {
  const theme = useTheme();
  const borderColor =
    tone === "warning"
      ? theme.warning
      : tone === "danger"
        ? theme.danger
        : tone === "accent"
          ? theme.accent
          : theme.border;
  const inner = Math.max(1, width - CARD_CHROME);

  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: true,
        borderColor,
        paddingLeft: 1,
        flexShrink: 0,
      }}
    >
      <box style={{ flexDirection: "row", width: inner }}>
        <text fg={theme.accent} attributes={BOLD}>
          {label}
        </text>
        {title ? (
          <text fg={theme.text}>{` ${fitText(title, Math.max(1, inner - label.length - 1))}`}</text>
        ) : null}
      </box>
      {subtitle ? <text fg={theme.muted}>{fitText(subtitle, inner)}</text> : null}
      {children}
    </box>
  );
}

/** Key/value rows inside a card, skipping the fields a payload did not carry. */
export function SeerEmbedFields({
  fields,
  width,
}: {
  fields: ReadonlyArray<readonly [string, string | undefined]>;
  width: number;
}) {
  return (
    <>
      {fields.flatMap(([name, value]) =>
        value ? [<Field key={name} name={name} value={value} width={width} />] : [],
      )}
    </>
  );
}

/** A run of prose inside a card, wrapped to the card's own width. */
export function SeerEmbedText({
  children,
  width,
  dim = false,
}: {
  children: string;
  width: number;
  dim?: boolean;
}) {
  const theme = useTheme();
  return (
    <>
      {wrapText(children, Math.max(1, width)).map((line, index) => (
        <text key={index} fg={dim ? theme.muted : theme.text} attributes={dim ? DIM : undefined}>
          {line}
        </text>
      ))}
    </>
  );
}

/**
 * The loading and failure lines a fetching embed shows.
 *
 * Returns `null` once there is something to draw, so a card can render this
 * above its rows and have it disappear when they arrive rather than branching
 * three ways at every call site.
 */
export function SeerEmbedStatus({
  status,
  noun,
  empty = false,
}: {
  status: AsyncStatus<unknown>;
  noun: string;
  /** True when the fetch succeeded and returned nothing. */
  empty?: boolean;
}) {
  const theme = useTheme();
  const error = errorOf(status);

  if (error) {
    return (
      <text fg={theme.danger}>{`${BODY_INDENT}Could not load ${noun}: ${error.message}`}</text>
    );
  }
  if (status.state === "idle" || isInitialLoad(status)) {
    return <text fg={theme.muted}>{`${BODY_INDENT}Loading ${noun}…`}</text>;
  }
  if (empty) {
    return <text fg={theme.subText}>{`${BODY_INDENT}No ${noun} found.`}</text>;
  }
  return null;
}
