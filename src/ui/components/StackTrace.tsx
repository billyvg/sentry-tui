import type { ExceptionValue } from "~/api/types";
import { theme } from "~/core/theme";
import {
  buildStackRows,
  filetypeFor,
  formatFrameTitle,
  frameIsExpandable,
  type FrameLike,
} from "~/lib/stacktrace";
import { fitText } from "~/lib/text";
import { useSyntaxStyle } from "~/ui/hooks/useSyntaxStyle";

export function ExceptionSection({
  value,
  width,
  expandedFrames,
  includeSystemFrames,
}: {
  value: ExceptionValue;
  width: number;
  expandedFrames: ReadonlySet<number>;
  includeSystemFrames: boolean;
}) {
  const rows = buildStackRows(value.stacktrace, { includeSystemFrames });

  return (
    <box style={{ flexDirection: "column", width }}>
      <text fg={theme.danger} attributes={1 /* BOLD */}>
        {fitText(value.type ?? "Error", width)}
      </text>
      {value.value ? <text fg={theme.text}>{fitText(value.value, width)}</text> : null}
      {value.mechanism ? (
        <text fg={theme.muted}>
          {`mechanism: ${value.mechanism.type}${value.mechanism.handled ? "" : " · unhandled"}`}
        </text>
      ) : null}

      {rows.map((row) =>
        row.kind === "omitted" ? (
          <text key={`omitted-${row.from}`} fg={theme.muted}>
            {`  … frames ${row.from}–${row.to} omitted`}
          </text>
        ) : (
          <FrameRow
            key={row.index}
            frame={row.frame}
            width={width}
            repeats={row.repeats}
            hiddenBefore={row.hiddenBefore}
            expanded={expandedFrames.has(row.index)}
          />
        ),
      )}

      {rows.length === 0 ? <text fg={theme.muted}>No stack trace available.</text> : null}
    </box>
  );
}

function FrameRow({
  frame,
  width,
  repeats,
  hiddenBefore,
  expanded,
}: {
  frame: FrameLike;
  width: number;
  repeats: number;
  hiddenBefore: number;
  expanded: boolean;
}) {
  const expandable = frameIsExpandable(frame);
  const marker = expandable ? (expanded ? "▾" : "▸") : " ";

  return (
    <box style={{ flexDirection: "column", width }}>
      {hiddenBefore > 0 ? (
        <text fg={theme.muted}>
          {`  ▸ ${hiddenBefore} more frame${hiddenBefore === 1 ? "" : "s"}`}
        </text>
      ) : null}

      <box style={{ flexDirection: "row", width }}>
        <text fg={theme.muted}>{` ${marker} `}</text>
        <text fg={frame.inApp ? theme.text : theme.muted}>
          {fitText(formatFrameTitle(frame), width - 14)}
        </text>
        <box style={{ flexGrow: 1 }} />
        {repeats > 0 ? <text fg={theme.muted}>{`×${repeats + 1} `}</text> : null}
        {frame.inApp ? <text fg={theme.accent}>{"In App"}</text> : null}
      </box>

      {expanded ? <FrameContext frame={frame} width={width} /> : null}
    </box>
  );
}

function FrameContext({ frame, width }: { frame: FrameLike; width: number }) {
  const syntaxStyle = useSyntaxStyle();
  // Highlighting is an enhancement: until the style resolves (and for
  // languages without a bundled grammar) the source still renders as plain
  // text rather than not at all.
  const filetype = syntaxStyle ? filetypeFor(frame) : undefined;
  const vars = frame.vars ? Object.entries(frame.vars) : [];

  return (
    <box style={{ flexDirection: "column", width, paddingLeft: 5 }}>
      {frame.context.map(([lineNo, source]) => {
        const active = lineNo === frame.lineNo;
        const gutter = String(lineNo).padStart(5);
        return (
          <box key={lineNo} style={{ flexDirection: "row", width: width - 5 }}>
            <text fg={active ? theme.accent : theme.muted}>
              {`${gutter} ${active ? "❯" : " "} `}
            </text>
            {filetype && syntaxStyle ? (
              <code
                content={source ?? ""}
                filetype={filetype}
                syntaxStyle={syntaxStyle}
                style={{ flexGrow: 1 }}
              />
            ) : (
              <text fg={active ? theme.text : theme.muted}>
                {fitText(source ?? "", width - 14)}
              </text>
            )}
          </box>
        );
      })}

      {vars.length > 0 ? (
        <box style={{ flexDirection: "column", paddingTop: 1 }}>
          <text fg={theme.muted}>Local variables</text>
          {vars.map(([name, value]) => (
            <text key={name} fg={theme.muted}>
              {fitText(`  ${name} = ${formatVar(value)}`, width - 6)}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  );
}

function formatVar(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
