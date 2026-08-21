/**
 * The attribute keys the query builder offers, as async state.
 *
 * Two requests — string and number — issued together and abandoned together,
 * because the visualize list needs one, the group-by list needs the other, and
 * a builder that filled in half at a time would offer a different menu
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
  loading: boolean;
}

const NONE: readonly TraceItemAttribute[] = [];
const IDLE: TraceItemAttributes = { string: NONE, number: NONE, loading: false };

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

    const load = (attributeType: "string" | "number") =>
      listTraceItemAttributes(client, {
        org,
        itemType,
        attributeType,
        statsPeriod,
        project: projectKey ? projectKey.split(",") : undefined,
        environment: environmentKey ? environmentKey.split(",") : undefined,
        signal: controller.signal,
      }).catch(() => NONE);

    void Promise.all([load("string"), load("number")]).then(([strings, numbers]) => {
      if (cancelled) return;
      setAttributes({ string: strings, number: numbers, loading: false });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, itemType, statsPeriod, projectKey, environmentKey]);

  return attributes;
}
