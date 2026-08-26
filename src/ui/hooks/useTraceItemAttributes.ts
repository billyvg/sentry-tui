/**
 * The attribute keys the query builder offers, as async state.
 *
 * Three requests — string, number and boolean — issued together and abandoned
 * together, because the visualize list and group-by list need all three, and
 * a builder that filled in part at a time would offer a different menu
 * depending on when it was opened.
 *
 * Both lists follow the same page filters as the table, so an attribute is
 * offered only where it exists. A failed fetch resolves to no attributes
 * rather than an error: the dropdown says so in its placeholder, and the rest
 * of the screen is unaffected.
 */

import { useEffect, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listTraceItemAttributes,
  type TraceItemAttribute,
  type TraceItemType,
} from "~/api/traceItemAttributes";

export interface TraceItemAttributes {
  /** Attributes holding text — what `count_unique` and Group By read. */
  string: readonly TraceItemAttribute[];
  /** Attributes holding numbers — what the numeric aggregates read. */
  number: readonly TraceItemAttribute[];
  /** Boolean attributes — valid for `count_unique` and Group By. */
  boolean: readonly TraceItemAttribute[];
  loading: boolean;
}

const NONE: readonly TraceItemAttribute[] = [];
const IDLE: TraceItemAttributes = { string: NONE, number: NONE, boolean: NONE, loading: false };

export interface TraceItemAttributesQuery {
  org: string;
  /** `undefined` on a screen with no query builder — nothing is fetched. */
  itemType: TraceItemType | undefined;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
}

export function useTraceItemAttributes(
  client: SentryClient | null,
  { org, itemType, statsPeriod, project, environment }: TraceItemAttributesQuery,
): TraceItemAttributes {
  const [attributes, setAttributes] = useState<TraceItemAttributes>(IDLE);

  // Joined rather than passed as arrays: a fresh `[]` every render would
  // refetch on every render.
  const projectKey = project?.join(",") ?? "";
  const environmentKey = environment?.join(",") ?? "";

  useEffect(() => {
    if (!client || !itemType) {
      setAttributes(IDLE);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setAttributes((current) => ({ ...current, loading: true }));

    const load = (attributeType: "string" | "number" | "boolean") =>
      listTraceItemAttributes(client, {
        org,
        itemType,
        attributeType,
        statsPeriod,
        project: projectKey ? projectKey.split(",") : undefined,
        environment: environmentKey ? environmentKey.split(",") : undefined,
        signal: controller.signal,
      }).catch(() => NONE);

    void Promise.all([load("string"), load("number"), load("boolean")]).then(
      ([strings, numbers, booleans]) => {
        if (cancelled) return;
        setAttributes({ string: strings, number: numbers, boolean: booleans, loading: false });
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, itemType, statsPeriod, projectKey, environmentKey]);

  return attributes;
}
