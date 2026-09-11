import type { SentryClient } from "~/api/client";

/** A timed span in the trace, including descendants returned by the trace endpoint. */
export interface TraceSpan {
  id: string;
  name: string;
  op?: string;
  project?: string;
  durationMs: number;
}

/** Fetch the trace's spans using the same timestamp scope as the web waterfall. */
export async function fetchTraceSpans(
  client: SentryClient,
  {
    org,
    traceId,
    timestamp,
    signal,
  }: {
    org: string;
    traceId: string;
    timestamp?: string;
    signal?: AbortSignal;
  },
): Promise<TraceSpan[]> {
  const seconds = timestamp ? Date.parse(timestamp) / 1000 : NaN;
  const page = await client.request<unknown>(
    `/organizations/${encodeURIComponent(org)}/trace/${encodeURIComponent(traceId)}/`,
    {
      query: {
        project: -1,
        timestamp: Number.isFinite(seconds) ? seconds : undefined,
        statsPeriod: Number.isFinite(seconds) ? undefined : "14d",
        limit: 10000,
        referrer: "sentry-tui.seer.trace",
      },
      signal,
    },
  );
  if (!Array.isArray(page.data)) throw new TypeError("Invalid trace response");
  const pending: unknown[] = [...page.data];
  const spans = new Map<string, TraceSpan>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (Array.isArray(row["children"])) pending.push(...row["children"]);
    if (row["event_type"] !== "span" || typeof row["event_id"] !== "string") continue;
    const start = row["start_timestamp"];
    const end = row["end_timestamp"];
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(end - start) ||
      end < start
    )
      continue;
    spans.set(row["event_id"], {
      id: row["event_id"],
      name:
        typeof row["description"] === "string"
          ? row["description"]
          : typeof row["name"] === "string"
            ? row["name"]
            : row["event_id"],
      op: typeof row["op"] === "string" ? row["op"] : undefined,
      project: typeof row["project_slug"] === "string" ? row["project_slug"] : undefined,
      durationMs: (end - start) * 1000,
    });
  }
  return [...spans.values()].sort(
    (a, b) => b.durationMs - a.durationMs || a.id.localeCompare(b.id),
  );
}
