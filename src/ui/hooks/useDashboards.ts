import { useEffect, useMemo, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import {
  listDashboards,
  listStarredDashboards,
  type DashboardListFilter,
  type DashboardListItem,
  type DashboardSort,
} from "~/api/dashboards";
import {
  idle,
  rejected,
  resolved,
  startLoading,
  toAsyncError,
  type AsyncStatus,
} from "~/core/async";
import { withPrebuiltListMetadata } from "~/core/prebuiltDashboards";
import { NO_NAV_EXTRAS, type SecondaryNavExtras } from "~/ui/lib/navSections";

export interface DashboardsQuery {
  org: string;
  /** Server-side filter — `onlyPrebuilt` for the Sentry Built screen. */
  filter?: DashboardListFilter;
  /** Committed search query; the endpoint matches it against the title. */
  query?: string;
  sort?: DashboardSort;
  /** Bump to refetch an unchanged query — the app's global refresh. */
  reloadToken?: number;
}

export interface DashboardsState {
  dashboards: AsyncStatus<DashboardListItem[]>;
  nextCursor: string | null;
}

/**
 * Fetch the org's dashboards for a list screen.
 *
 * Shaped like `useLogs`: one request per query, the superseded one aborted so
 * that typing in the search bar can't land an older page on top of a newer one.
 * Manual refresh only — nothing here polls.
 */
export function useDashboards(
  client: SentryClient | null,
  { org, filter, query = "", sort, reloadToken = 0 }: DashboardsQuery,
): DashboardsState {
  const [status, setStatus] = useState<AsyncStatus<DashboardListItem[]>>(idle);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    setStatus(startLoading(statusRef.current, Date.now()));

    void (async () => {
      try {
        const page = await listDashboards(client, { org, filter, query, sort, signal });
        if (cancelled) return;
        setStatus(
          resolved(
            Array.isArray(page.data) ? page.data.map(withPrebuiltListMetadata) : [],
            Date.now(),
          ),
        );
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (cancelled || signal.aborted) return;
        setStatus(rejected(statusRef.current, toAsyncError(error)));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, filter, query, sort, reloadToken]);

  return { dashboards: status, nextCursor };
}

/**
 * The dashboards the user has starred, for the sidebar's dynamic section.
 *
 * Returns an empty list rather than an error state: a failed sidebar fetch
 * should cost the user a section, not a screen. The list endpoint the screens
 * use surfaces its own failures.
 *
 * @param enabled Only fetch while the Dashboards sidebar is the one open —
 *   the section is invisible otherwise, and the nav is mounted all session, so
 *   an ungated fetch would run on app start.
 */
export function useStarredDashboards(
  client: SentryClient | null,
  { org, enabled, reloadToken = 0 }: { org: string; enabled: boolean; reloadToken?: number },
): DashboardListItem[] {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);

  useEffect(() => {
    if (!client || !enabled || !org) {
      setDashboards([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void listStarredDashboards(client, { org, signal: controller.signal })
      .then((data) => {
        if (!cancelled) setDashboards(data.map(withPrebuiltListMetadata));
      })
      .catch(() => {
        if (!cancelled) setDashboards([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, org, enabled, reloadToken]);

  return dashboards;
}

/**
 * The Dashboards group's contribution to the sidebar: a Starred Dashboards
 * section, or nothing.
 *
 * One hook per nav group, called unconditionally from
 * `useSecondaryNavExtras` with an `enabled` flag — see that file.
 *
 * A starred dashboard has no screen of its own, so its item targets the list
 * that contains it. Landing the user on the dashboard itself needs a way to
 * carry the row through a nav destination; that mechanism is being built
 * generically elsewhere, and this is the interim.
 */
export function useDashboardsNavExtras(
  client: SentryClient | null,
  org: string,
  enabled: boolean,
  reloadToken: number,
): SecondaryNavExtras {
  const starred = useStarredDashboards(client, { org, enabled, reloadToken });

  return useMemo(() => {
    // The web hides the section when nothing is starred rather than showing an
    // empty heading; so do we.
    if (starred.length === 0) return NO_NAV_EXTRAS;
    return {
      sections: [
        {
          title: "Starred Dashboards",
          items: starred.map((dashboard) => ({
            label: dashboard.title,
            target: { group: "dashboards" as const, item: "All Dashboards" },
          })),
        },
      ],
    };
  }, [starred]);
}
