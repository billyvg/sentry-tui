import { useEffect, useMemo, useRef, useState } from "react";

import type { SentryClient } from "~/api/client";
import { listProjectReferences, listProjects } from "~/api/issues";
import type { Project } from "~/api/types";
import { filterByLabel } from "~/ui/lib/listFilter";

type ProjectSlugCache = Map<string, Promise<string | undefined>>;

/** Resolved, missing, and in-flight slugs, scoped to one authenticated session. */
const projectSlugs = new WeakMap<SentryClient, Map<string, ProjectSlugCache>>();
const NO_PROJECT_SLUGS: ReadonlyMap<string, string> = new Map();

/**
 * Resolve the requested IDs while reusing every answer learned this session.
 *
 * Each id owns a promise before its batch request starts, so overlapping
 * callers share both completed answers and in-flight work. Missing ids resolve
 * to `undefined` and stay cached; rejected entries are evicted for retry.
 */
async function loadProjectSlugs(
  client: SentryClient,
  org: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  let byOrg = projectSlugs.get(client);
  if (!byOrg) {
    byOrg = new Map();
    projectSlugs.set(client, byOrg);
  }

  let cache = byOrg.get(org);
  if (!cache) {
    cache = new Map();
    byOrg.set(org, cache);
  }

  const missing = ids.filter((id) => !cache.has(id));
  if (missing.length > 0) {
    const batch = listProjectReferences(client, { org, ids: missing }).then(
      (projects) => new Map(projects.map((project) => [project.id, project.slug])),
    );

    for (const id of missing) {
      const entry = batch.then((slugs) => slugs.get(id));
      cache.set(id, entry);
      void entry.catch(() => {
        if (cache.get(id) === entry) cache.delete(id);
      });
    }
  }

  const entries = await Promise.all(
    ids.map(async (id): Promise<readonly [string, string] | undefined> => {
      const slug = await cache.get(id);
      return slug === undefined ? undefined : [id, slug];
    }),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
}

/**
 * Project id → slug for only the ids the caller's current rows reference.
 *
 * Requests are independent of organization size: ids are de-duplicated,
 * batched by the API helper, and cached per client/org for the session. The
 * picker keeps its own one-page text-search path — see {@link useProjectSearch}.
 *
 * @param ids Numeric project ids from the rows currently held by the caller.
 * @param enabled Skip resolution for a caller mounted before its section opens.
 */
export function useProjectSlugs(
  client: SentryClient | null,
  org: string,
  ids: readonly string[],
  enabled = true,
): ReadonlyMap<string, string> {
  const key = [...new Set(ids.filter((id) => /^\d+$/.test(id)))].sort().join(",");
  const [answer, setAnswer] = useState<{
    client: SentryClient;
    org: string;
    key: string;
    slugs: ReadonlyMap<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!client || !enabled || key === "") return;
    let mounted = true;
    void loadProjectSlugs(client, org, key.split(","))
      .then((slugs) => {
        if (mounted) setAnswer({ client, org, key, slugs });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [client, org, key, enabled]);

  return answer?.client === client && answer.org === org && answer.key === key
    ? answer.slugs
    : NO_PROJECT_SLUGS;
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
