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
 */
export function useProjects(client: SentryClient | null, org: string): Project[] {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void listProjects(client, { org, signal: controller.signal })
      .then(setProjects)
      .catch(() => {});
    return () => controller.abort();
  }, [client, org]);

  return projects;
}
