import { useEffect, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listProjects } from "~/api/issues";
import type { Project } from "~/api/types";

/**
 * The organization's projects, fetched once per client/org.
 *
 * Shared by the filter bar (which lists them) and the saved-views screen
 * (which needs the id → slug mapping), so both read the same list rather than
 * each keeping their own copy. A failure yields an empty list: every caller
 * degrades to "no project filter", which is the right fallback.
 *
 * @param enabled Skip the fetch and stay empty. For a caller mounted for the
 *   whole session that only needs projects some of the time — the secondary
 *   nav's dynamic sections — so opening the app doesn't ask for them.
 */
export function useProjects(client: SentryClient | null, org: string, enabled = true): Project[] {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!client || !enabled) return;
    const controller = new AbortController();
    void listProjects(client, { org, signal: controller.signal })
      .then(setProjects)
      .catch(() => {});
    return () => controller.abort();
  }, [client, org, enabled]);

  return projects;
}
