import { Fragment } from "react";

import type { SentryClient } from "~/api/client";
import {
  inlineSeerEmbed,
  reportUnknownSeerEmbed,
  seerEmbedLevel,
  STRUCTURED_SEER_EMBEDS,
} from "~/core/seerEmbeds";
import { wrapText } from "~/lib/text";
import { SeerBlockEmbed } from "~/ui/components/SeerEmbeds";
import { useSyntaxStyle } from "~/ui/hooks/useSyntaxStyle";
import { useTheme } from "~/ui/theme";

interface MarkdownSegment {
  content?: string;
  data?: Record<string, unknown>;
  kind: "markdown" | "embed";
  name?: string;
}

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
      name && STRUCTURED_SEER_EMBEDS.has(name)
        ? structuredData
        : (bodyData ?? (Object.keys(attributes).length > 0 ? attributes : structuredData));
    cursor = index + raw.length;

    // Markdoc decides block versus inline from the node's position. The
    // terminal reads the same thing off the source: a tag with nothing but
    // whitespace either side of it on its line is a block.
    const linePrefix = content.slice(content.lastIndexOf("\n", index - 1) + 1, index).trim();
    const nextBreak = content.indexOf("\n", cursor);
    const lineSuffix = content.slice(cursor, nextBreak === -1 ? content.length : nextBreak).trim();
    const level = name ? seerEmbedLevel(name, linePrefix === "" && lineSuffix === "") : null;

    if (!name || !level) {
      // Unknown tags are dropped rather than echoed, matching the web
      // renderer: a raw `{% … %}` in a transcript reads as a bug, and the
      // counter is what says a new embed shipped ahead of this binary.
      if (name) reportUnknownSeerEmbed(name, "block");
      continue;
    }

    // A self-closing structured tag can arrive one poll before its effects
    // payload. Keep it human-readable until the correlated data catches up.
    const embedData = data ?? {};

    if (!embedsEnabled || level === "inline") {
      markdown += inlineSeerEmbed(name, embedData);
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

/** Render standard Markdown plus the structured widgets Seer emits inside it. */
export function SeerMarkdown({
  content,
  width,
  client = null,
  org = "",
  streaming = false,
  embedsEnabled = false,
  structuredContent = null,
}: {
  content: string;
  width: number;
  client?: SentryClient | null;
  org?: string;
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
            <SeerBlockEmbed
              key={`embed-${index}`}
              name={segment.name}
              data={segment.data}
              width={Math.max(8, width - 2)}
              client={client}
              org={org}
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
