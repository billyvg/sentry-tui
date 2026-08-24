import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listGroupSearchViews, type GroupSearchView, type ViewSort } from "~/api/groupSearchViews";
import {
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
} from "~/core/async";

/** A titled run of views, matching one of the web page's two tables. */
export interface ViewSection {
  title: string;
  views: GroupSearchView[];
}

/**
 * Fetch the org's saved issue views, grouped the way the web page groups them.
 *
 * Two requests rather than one because the endpoint's `createdBy` defaults to
 * `me` — asking once would quietly return only the current user's views and
 * look like the org has none.
 *
 * Mirrors `useLogs` in shape: a superseded request is aborted so fast
 * navigation doesn't race.
 */
export function useGroupSearchViews(
  client: SentryClient | null,
  { org, sort, reloadToken = 0 }: { org: string; sort?: ViewSort; reloadToken?: number },
): AsyncStatus<ViewSection[]> {
  const [sections, setSections] = useState<AsyncStatus<ViewSection[]>>(idle);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setSections(startLoading(sectionsRef.current, Date.now()));

    void (async () => {
      try {
        const [mine, others] = await Promise.all([
          listGroupSearchViews(client, { org, createdBy: "me", sort, signal }),
          listGroupSearchViews(client, { org, createdBy: "others", sort, signal }),
        ]);
        if (cancelled) return;
        setSections(
          resolved(
            [
              { title: "Created by Me", views: mine.data },
              { title: "Created by Others", views: others.data },
            ],
            Date.now(),
          ),
        );
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setSections(rejected(sectionsRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, sort, reloadToken]);

  return sections;
}
