import { useEffect, useMemo, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listProjects } from "~/api/issues";
import type { Project } from "~/api/types";
import { filterByLabel } from "~/ui/lib/listFilter";

/**
 * The organization's projects, fetched once per client/org.
 *
 * Shared by the filter bar (which lists them) and the saved-views screen
 * (which needs the id → slug mapping), so both read the same list rather than
 * each keeping their own copy. A failure yields an empty list: every caller
 * degrades to "no project filter", which is the right fallback.
 *
 * One page of them, so an org with more projects than that has some missing.
 * The picker covers its own case by searching — see {@link useProjectSearch}.
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

/** How long typing settles before a search goes out. */
export const SEARCH_DEBOUNCE_MS = 200;

export interface ProjectSearch {
  /** Projects to offer for the current query, best match first. */
  projects: Project[];
  /** A search for the current query is out — rows may still be arriving. */
  loading: boolean;
}

/**
 * The projects matching what has been typed into the picker.
 *
 * Two searches, unioned. The server's is the one that can see projects outside
 * the first page — the whole reason the query leaves the machine — but it only
 * matches a substring of a slug or a name, so it finds nothing for the
 * non-contiguous queries the app's other pickers take. The local one is the
 * fuzzy match those pickers do, over every project fetched so far. Neither
 * alone is enough: fuzzy-ranked local hits lead, server-only hits follow.
 *
 * Everything a search returns joins the pool the local pass reads, so a project
 * stays selectable once seen — including while the next keystroke's request is
 * still out, which is what keeps the list from emptying as you type.
 *
 * An answer already held is reused rather than asked for again, so backing out
 * of a query is instant and closing the picker costs nothing. Switching org or
 * client drops all of it: none of those projects are this org's.
 */
export function useProjectSearch(
  client: SentryClient | null,
  org: string,
  query: string,
): ProjectSearch {
  /** Every project seen so far, in the order first seen. */
  const [pool, setPool] = useState<Project[]>([]);
  /** The last search that landed, tagged with the query it answered. */
  const [answer, setAnswer] = useState<{ query: string; projects: Project[] } | null>(null);
  const [loading, setLoading] = useState(false);
  /** Projects per query asked, so far. */
  const answered = useRef(new Map<string, Project[]>());

  const needle = query.trim();

  useEffect(() => {
    answered.current.clear();
    setPool([]);
    setAnswer(null);
  }, [client, org]);

  useEffect(() => {
    if (!client) return;

    const held = answered.current.get(needle);
    if (held) {
      setAnswer({ query: needle, projects: held });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    // The opening list is nobody's keystroke, so it goes out immediately;
    // every search after it waits for the typing to settle.
    const timer = setTimeout(
      () => {
        void listProjects(client, { org, query: needle, signal: controller.signal })
          .then((found) => {
            if (cancelled) return;
            answered.current.set(needle, found);
            setPool((current) => mergePool(current, found));
            setAnswer({ query: needle, projects: found });
            setLoading(false);
          })
          .catch(() => {
            // Leave the previous answer standing: a failed search falls back to
            // the local match over what is already held, which is a shorter
            // list rather than a broken one.
            if (!cancelled) setLoading(false);
          });
      },
      needle ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, org, needle]);

  const projects = useMemo(() => {
    // Only the answer to *this* query counts; an older one is a list of
    // matches for something else, and whatever it taught the pool is already
    // in reach of the local pass.
    const matched = answer?.query === needle ? answer.projects : [];
    if (!needle) return matched.length > 0 ? matched : pool;

    const local = filterByLabel(
      pool.map((project) => ({ label: project.slug, project })),
      needle,
    ).map((row) => row.item.project);

    const seen = new Set(local.map((project) => project.id));
    return [...local, ...matched.filter((project) => !seen.has(project.id))];
  }, [pool, answer, needle]);

  return { projects, loading };
}

/** `found` folded into `current`, keeping first-seen order and no duplicates. */
function mergePool(current: Project[], found: Project[]): Project[] {
  const known = new Set(current.map((project) => project.id));
  const added = found.filter((project) => !known.has(project.id));
  return added.length > 0 ? [...current, ...added] : current;
}
