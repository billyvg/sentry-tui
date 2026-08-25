import { Fragment } from "react";

import { sparkline } from "~/lib/sparkline";
import { wrapText } from "~/lib/text";
import { BOLD, DIM } from "~/ui/lib/attributes";
import { useSyntaxStyle } from "~/ui/hooks/useSyntaxStyle";
import { useTheme } from "~/ui/theme";

interface MarkdownSegment {
  content?: string;
  data?: Record<string, unknown>;
  kind: "markdown" | "embed";
  name?: string;
}

const BLOCK_EMBEDS = new Set(["dsn", "issues", "chart", "autofix", "agentWriteApproval"]);
const KNOWN_EMBEDS = new Set([
  "timestamp",
  "docs",
  "dsn",
  "user",
  "issue",
  "issues",
  "chart",
  "autofix",
  "agentWriteApproval",
]);
const STRUCTURED_EMBEDS = new Set(["agentWriteApproval"]);
const EMBED_PATTERN = /\{%\s*([A-Za-z][\w]*)([^%]*?)\s*(?:\/%\}|%\}([\s\S]*?)\{%\s*\/\1\s*%\})/g;

/** Parse Seer's Markdoc-style tags while leaving ordinary Markdown to OpenTUI. */
export function splitSeerMarkdown(
  content: string,
  embedsEnabled: boolean,
  structuredContent: Record<string, unknown> | null = null,
): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let markdown = "";
  let cursor = 0;

  const flush = () => {
    if (markdown) segments.push({ kind: "markdown", content: markdown });
    markdown = "";
  };

  for (const match of content.matchAll(EMBED_PATTERN)) {
    const index = match.index ?? cursor;
    markdown += content.slice(cursor, index);
    const raw = match[0];
    const name = match[1];
    const attributes = parseEmbedAttributes(match[2]);
    const bodyData = parseEmbedData(match[3]);
    const structuredData = name ? objectValue(structuredContent?.[name]) : null;
    const data =
      name && STRUCTURED_EMBEDS.has(name)
        ? structuredData
        : (bodyData ?? (Object.keys(attributes).length > 0 ? attributes : structuredData));
    cursor = index + raw.length;
    const linePrefix = content.slice(content.lastIndexOf("\n", index - 1) + 1, index).trim();
    const nextBreak = content.indexOf("\n", cursor);
    const lineSuffix = content.slice(cursor, nextBreak === -1 ? content.length : nextBreak).trim();
    const issueIsBlock = name === "issue" && linePrefix === "" && lineSuffix === "";

    if (!name || !KNOWN_EMBEDS.has(name)) {
      markdown += raw;
      continue;
    }

    // A self-closing structured tag can arrive one poll before its effects
    // payload. Keep it human-readable until the correlated data catches up.
    const embedData = data ?? {};

    if (!embedsEnabled || (!BLOCK_EMBEDS.has(name) && !issueIsBlock)) {
      markdown += inlineEmbed(name, embedData);
      continue;
    }

    flush();
    segments.push({ kind: "embed", name, data: embedData });
  }

  markdown += content.slice(cursor);
  flush();
  return segments;
}

/** Parse simple Markdoc attributes as a fallback for self-closing inline tags. */
function parseEmbedAttributes(raw: string | undefined): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  if (!raw) return attributes;
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of raw.matchAll(pattern)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (key && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

/** Decode a bounded embed JSON object without allowing malformed content to break the transcript. */
function parseEmbedData(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Narrow a structured effect payload to the object embeds expect. */
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Terminal fallback for inline embeds and for organizations without the embed feature. */
function inlineEmbed(name: string, data: Record<string, unknown>): string {
  if (name === "timestamp") {
    const value = stringValue(data["value"]);
    if (!value) return "";
    if (data["format"] === "relative") return relativeTime(value);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
  }
  if (name === "docs") {
    const title = stringValue(data["title"]);
    const href = stringValue(data["href"]);
    return title && href ? `[${title}](${href})` : (title ?? href ?? "");
  }
  if (name === "user") return `@${stringValue(data["name"]) ?? "user"}`;
  if (name === "issue") return `**${stringValue(data["id"]) ?? "issue"}**`;
  if (name === "issues") {
    const ids = stringArray(data["ids"]);
    return ids.length ? ids.map((id) => `**${id}**`).join(", ") : "Issues";
  }

  if (name === "dsn") return `\`${stringValue(data["value"]) ?? "DSN"}\``;
  if (name === "autofix") return stringValue(data["result"]) ?? "Autofix result";
  if (name === "chart") return stringValue(data["title"]) ?? "Chart";
  if (name === "agentWriteApproval") return "Seer requested permission to make changes.";
  return "";
}

/** Compact relative timestamp used by the web embed, without a live timer in the terminal. */
function relativeTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const seconds = Math.round((parsed - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const [amount, unit] =
    absolute < 60
      ? [absolute, "second"]
      : absolute < 3600
        ? [Math.round(absolute / 60), "minute"]
        : absolute < 86_400
          ? [Math.round(absolute / 3600), "hour"]
          : [Math.round(absolute / 86_400), "day"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ${seconds < 0 ? "ago" : "from now"}`;
}

/** Render standard Markdown plus the structured widgets Seer emits inside it. */
export function SeerMarkdown({
  content,
  width,
  streaming = false,
  embedsEnabled = false,
  structuredContent = null,
}: {
  content: string;
  width: number;
  streaming?: boolean;
  embedsEnabled?: boolean;
  structuredContent?: Record<string, unknown> | null;
}) {
  const theme = useTheme();
  const syntaxStyle = useSyntaxStyle();
  const segments = splitSeerMarkdown(content, embedsEnabled, structuredContent);

  return (
    <box style={{ flexDirection: "column", width }}>
      {segments.map((segment, index) => {
        if (segment.kind === "embed" && segment.name && segment.data) {
          return (
            <SeerEmbed
              key={`embed-${index}`}
              name={segment.name}
              data={segment.data}
              width={width}
            />
          );
        }
        const markdown = segment.content ?? "";
        if (!syntaxStyle) {
          return (
            <Fragment key={`markdown-${index}`}>
              {wrapText(markdown, Math.max(1, width)).map((line, lineIndex) => (
                <text key={lineIndex} fg={theme.text}>
                  {line}
                </text>
              ))}
            </Fragment>
          );
        }
        return (
          <markdown
            key={`markdown-${index}-${streaming ? "stream" : "static"}`}
            content={markdown}
            syntaxStyle={syntaxStyle}
            // OpenTUI's streaming path seeds styled text synchronously, then
            // replaces it with Tree-sitter output. Keeping that path active
            // also prevents a finished answer from being blank for one frame
            // while the Markdown grammar starts in a compiled binary.
            streaming
            fg={theme.text}
            conceal
            internalBlockMode="top-level"
            tableOptions={{
              style: "columns",
              widthMode: "full",
              wrapMode: "word",
              borderColor: theme.border,
            }}
            style={{ width }}
          />
        );
      })}
    </box>
  );
}

/** Render one validated-enough Seer embed as a terminal-native card. */
function SeerEmbed({
  name,
  data,
  width,
}: {
  name: string;
  data: Record<string, unknown>;
  width: number;
}) {
  const theme = useTheme();
  const cardWidth = Math.max(8, width - 2);

  if (name === "issue") {
    const id = stringValue(data["id"]) ?? "Unknown issue";
    return (
      <box
        style={{
          flexDirection: "row",
          width: cardWidth,
          border: true,
          borderColor: theme.border,
          paddingLeft: 1,
        }}
      >
        <text fg={theme.accent}>◆ </text>
        <text fg={theme.text} attributes={BOLD}>
          {id}
        </text>
      </box>
    );
  }

  if (name === "dsn") {
    return (
      <box style={{ width: cardWidth, border: true, borderColor: theme.border, paddingLeft: 1 }}>
        <text fg={theme.accent}>{stringValue(data["value"]) ?? "DSN unavailable"}</text>
      </box>
    );
  }

  if (name === "issues") {
    const ids = stringArray(data["ids"]);
    return (
      <box
        style={{
          flexDirection: "column",
          width: cardWidth,
          border: true,
          borderColor: theme.border,
        }}
      >
        <text fg={theme.text} attributes={BOLD}>{` Issues (${ids.length})`}</text>
        {ids.map((id) => (
          <text key={id} fg={theme.accent}>{`  ◆ ${id}`}</text>
        ))}
      </box>
    );
  }

  if (name === "chart") return <ChartEmbed data={data} width={cardWidth} />;

  if (name === "autofix") {
    const step = (stringValue(data["step"]) ?? "result").replace(/_/g, " ");
    const result = stringValue(data["result"]) ?? "No result returned.";
    return (
      <box
        style={{
          flexDirection: "column",
          width: cardWidth,
          border: true,
          borderColor: theme.accent,
          paddingLeft: 1,
        }}
      >
        <text fg={theme.accent} attributes={BOLD}>{`Autofix · ${step}`}</text>
        <text fg={theme.muted}>{stringValue(data["shortId"]) ?? ""}</text>
        {wrapText(result, Math.max(1, cardWidth - 3)).map((line, index) => (
          <text key={index} fg={theme.text}>
            {line}
          </text>
        ))}
      </box>
    );
  }

  if (name === "agentWriteApproval") {
    const status = stringValue(data["status"]) ?? "pending";
    const scopes = stringArray(data["requiredScopes"]);
    return (
      <box
        style={{
          flexDirection: "column",
          width: cardWidth,
          border: true,
          borderColor: theme.warning,
          paddingLeft: 1,
        }}
      >
        <text
          fg={
            status === "approved"
              ? theme.success
              : status === "rejected"
                ? theme.danger
                : theme.warning
          }
          attributes={BOLD}
        >
          {status === "pending" ? "Allow Seer to make changes?" : `Access ${status}`}
        </text>
        {scopes.map((scope) => (
          <text key={scope} fg={theme.muted}>{`  ${scope}`}</text>
        ))}
      </box>
    );
  }

  return <text fg={theme.muted}>{inlineEmbed(name, data)}</text>;
}

/** Render Seer's bounded chart payload as one sparkline per series. */
function ChartEmbed({ data, width }: { data: Record<string, unknown>; width: number }) {
  const theme = useTheme();
  const series = Array.isArray(data["series"]) ? data["series"].slice(0, 5) : [];
  const chartWidth = Math.max(8, Math.min(50, width - 4));
  return (
    <box
      style={{
        flexDirection: "column",
        width,
        border: true,
        borderColor: theme.border,
        paddingLeft: 1,
      }}
    >
      <text fg={theme.text} attributes={BOLD}>
        {stringValue(data["title"]) ?? "Chart"}
      </text>
      {stringValue(data["subtitle"]) ? (
        <text fg={theme.muted}>{stringValue(data["subtitle"])}</text>
      ) : null}
      {series.map((entry, index) => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const points = Array.isArray(record["data"])
          ? record["data"].flatMap((point, pointIndex) => {
              if (!point || typeof point !== "object") return [];
              const y = Number((point as Record<string, unknown>)["y"]);
              return Number.isFinite(y) ? ([[pointIndex, y]] as const) : [];
            })
          : [];
        const label =
          stringValue(record["label"]) ?? stringValue(record["name"]) ?? `Series ${index + 1}`;
        return (
          <box key={`${label}-${index}`} style={{ flexDirection: "column" }}>
            <text fg={index === 0 ? theme.accent : theme.muted}>
              {sparkline(points, chartWidth, { floor: true })}
            </text>
            <text fg={theme.muted} attributes={DIM}>
              {label}
            </text>
          </box>
        );
      })}
    </box>
  );
}

/** Narrow an unknown embed scalar to non-empty text. */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Narrow an unknown embed field to strings, dropping malformed entries. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
