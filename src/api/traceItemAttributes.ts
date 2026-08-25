/**
 * The attributes a trace item type actually has, for the query builder.
 *
 * `GET /organizations/{org}/trace-items/attributes/` answers the keys Sentry
 * has seen on spans (or logs, or trace metrics) in the selected projects and
 * period — the org's own data, which is why the group-by and visualize lists
 * cannot be a constant. The web reaches it through
 * `traceItemAttributeKeysOptions` (`views/explore/utils/`), and takes the same
 * page filters we do so the options agree with the table underneath them.
 *
 * One request per type rather than one for both: `attributeType` is documented
 * as accepting a list, but a deployment that reads only the first value would
 * silently answer half the options, and a missing group-by key is invisible.
 *
 * Read-only, and manual-refresh only: nothing here polls.
 */

import type { SentryClient } from "~/api/client";
import { projectParams } from "~/api/projectParams";

/** Trace item types the endpoint knows about. Left open — Sentry adds them. */
export type TraceItemType = "spans" | "logs" | "tracemetrics" | (string & {});

/** How a value is stored, which decides the aggregates that can read it. */
export type TraceItemAttributeType = "string" | "number" | "boolean";

export interface TraceItemAttribute {
  /** The key a query uses, e.g. `span.op`. */
  key: string;
  /** Sentry's display name for it, which for a user-defined tag is the key. */
  name: string;
  type: TraceItemAttributeType;
}

/** One entry as the endpoint returns it. */
interface RawAttribute {
  key?: unknown;
  name?: unknown;
  attributeType?: unknown;
}

export interface ListTraceItemAttributesParams {
  org: string;
  itemType: TraceItemType;
  attributeType: TraceItemAttributeType;
  project?: string[];
  environment?: string[];
  statsPeriod?: string;
  signal?: AbortSignal;
}

/**
 * The attribute keys of one type.
 *
 * @returns Keys sorted by display name, deduplicated. An entry without a key
 *   is dropped rather than trusted — it would reach a dropdown as a blank row
 *   that filters to nothing and queries to a 400.
 */
export async function listTraceItemAttributes(
  client: SentryClient,
  {
    org,
    itemType,
    attributeType,
    project,
    environment,
    statsPeriod,
    signal,
  }: ListTraceItemAttributesParams,
): Promise<TraceItemAttribute[]> {
  const page = await client.request<RawAttribute[]>(
    `/organizations/${org}/trace-items/attributes/`,
    {
      query: {
        itemType,
        attributeType,
        project: projectParams(project),
        environment,
        statsPeriod,
      },
      signal,
    },
  );

  const seen = new Set<string>();
  const attributes: TraceItemAttribute[] = [];
  for (const raw of Array.isArray(page.data) ? page.data : []) {
    const key = typeof raw?.key === "string" ? raw.key : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    attributes.push({
      key,
      name: typeof raw.name === "string" && raw.name ? raw.name : key,
      type: attributeType,
    });
  }
  attributes.sort((a, b) => a.name.localeCompare(b.name));
  return attributes;
}
