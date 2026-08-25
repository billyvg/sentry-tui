/**
 * The two fetches behind Explore › Releases.
 *
 * They are deliberately two hooks with two `AsyncStatus`es rather than one
 * hook awaiting both: the list is cheap and health is not, and collapsing them
 * into a single loading boolean would hold the cards off screen for as long as
 * the slowest half takes. See `src/api/releases.ts` for why health is its own
 * request.
 */

import { useEffect, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listReleaseHealth,
  listReleases,
  type Release,
  type ReleaseHealthIndex,
  type ReleaseSort,
} from "~/api/releases";
import {
  type AsyncStatus,
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
} from "~/core/async";

export interface ReleasesQuery {
  org: string;
  query: string;
  statsPeriod: string;
  project?: string[];
  environment?: string[];
  sort?: ReleaseSort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface ReleasesState {
  releases: AsyncStatus<Release[]>;
  nextCursor: string | null;
}

/** Fetch the release list, without health data. */
export function useReleases(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: ReleasesQuery,
): ReleasesState {
  const [releases, setReleases] = useState<AsyncStatus<Release[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const releasesRef = useRef(releases);
  releasesRef.current = releases;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setReleases(startLoading(releasesRef.current, Date.now()));

    void (async () => {
      try {
        const result = await listReleases(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          sort,
          signal,
        });
        if (cancelled) return;
        setReleases(resolved(result.data, Date.now()));
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setReleases(rejected(releasesRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, sort, reloadToken]);

  return { releases, nextCursor };
}

/**
 * Fetch session health for the same page of releases.
 *
 * Runs alongside the list rather than after it: both requests describe the
 * page by the same filters, so health does not have to wait for the versions
 * to come back before it can ask. A card whose pair is missing from the index
 * draws its health cells as unavailable, which is also what happens when a
 * project genuinely has no sessions.
 */
export function useReleaseHealth(
  client: SentryClient | null,
  { org, query, statsPeriod, project, environment, sort, reloadToken = 0 }: ReleasesQuery,
): AsyncStatus<ReleaseHealthIndex> {
  const [health, setHealth] = useState<AsyncStatus<ReleaseHealthIndex>>(idle);

  const healthRef = useRef(health);
  healthRef.current = health;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setHealth(startLoading(healthRef.current, Date.now()));

    void (async () => {
      try {
        const index = await listReleaseHealth(client, {
          org,
          query,
          statsPeriod,
          project,
          environment,
          sort,
          signal,
        });
        if (cancelled) return;
        setHealth(resolved(index, Date.now()));
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setHealth(rejected(healthRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, query, statsPeriod, project, environment, sort, reloadToken]);

  return health;
}
