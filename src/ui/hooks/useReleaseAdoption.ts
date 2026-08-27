import { useCallback } from "react";

import type { SentryClient } from "~/api/client";
import { listReleaseAdoption, type Release, type ReleaseAdoptionIndex } from "~/api/releases";
import type { AsyncStatus } from "~/core/async";
import { useAsyncFetch } from "~/ui/hooks/useAsyncFetch";

export interface ReleaseAdoptionQuery {
  org: string;
  /** The settled release page whose project rows need chart series. */
  releases: readonly Release[] | undefined;
  project?: string[];
  environment?: string[];
}

/** Fetch the 24-hour adoption mini-chart series for a settled release page. */
export function useReleaseAdoption(
  client: SentryClient | null,
  { org, releases, project, environment }: ReleaseAdoptionQuery,
): AsyncStatus<ReleaseAdoptionIndex> {
  const loader = useCallback(
    (signal: AbortSignal) =>
      client && releases
        ? listReleaseAdoption(client, { org, releases, project, environment, signal })
        : null,
    [client, org, releases, project, environment],
  );

  return useAsyncFetch(loader, { resetKey: releases }).status;
}
