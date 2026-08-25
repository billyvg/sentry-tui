/**
 * Per-screen state, keyed by screen.
 *
 * Every list screen owns the same ten things — its rows, its cursor, its load
 * status, which filter dropdown is open, the project/environment/period
 * filters, and the three-part search state (live value, committed value, and
 * the value to revert to). Declaring them ten times in `App` is what made
 * routing a pile of booleans; declaring them once, in a map keyed by screen,
 * is what lets filters and cursor survive navigating away and back.
 *
 * Screens that share a `stateKey` share one entry — see `src/core/screens.ts`.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { DEFAULT_SORT, DEFAULT_STATS_PERIOD } from "~/api/issues";
import { defaultsForStateKey } from "~/core/screens";
import type { FilterDropdownType } from "~/ui/components/FilterBar";

/** Where a screen's fetch has got to, as the status bar needs to read it. */
export interface ScreenStatus {
  loading: boolean;
  /** When the current load started; the status bar counts up from it. */
  since?: number;
  error?: string;
  /** What is loading, for the status bar: `"logs"` reads as "loading logs…". */
  noun?: string;
}

/** State held for one screen (or one group of screens sharing a `stateKey`). */
interface ScreenStateData {
  entries: readonly unknown[];
  selected: number;
  status: ScreenStatus;
  openDropdown: FilterDropdownType;
  /**
   * Projects the view is filtered to, empty for all. Holds *project refs*:
   * either a slug (what the filter dropdown writes) or a numeric id (what a
   * saved view carries). The issues endpoint accepts both, and `FilterBar`
   * resolves an id to its slug for display once the project list has landed.
   */
  selectedProjects: string[];
  selectedEnvs: string[];
  statsPeriod: string;
  /** Sort sent with the query. Each screen validates it against its own options. */
  sort: string;
  /** The screen's inline detail panel is open, below its list. */
  detailOpen: boolean;
  /** Live value of the search input, which may differ from what was submitted. */
  searchQuery: string;
  /** The query the data was fetched with — what Enter last committed. */
  committedQuery: string;
  searchFocused: boolean;
  /** Value to restore when editing is cancelled with Escape. */
  queryBeforeEdit: string;
}

/**
 * One screen's slice: its current values, plus setters whose identities are
 * stable for the life of the app, so a screen can list them in an effect's
 * dependencies without re-running it every render.
 */
export interface ScreenState extends ScreenStateData {
  /** The map key this slice is stored under. */
  key: string;
  /**
   * Replace the rows, or update them from their current value. The cursor is
   * clamped to the new length. Prefer the updater form for an edit that races
   * with a fetch — an optimistic write landing after its own request, say.
   */
  setEntries: (
    next: readonly unknown[] | ((previous: readonly unknown[]) => readonly unknown[]),
  ) => void;
  setSelected: (next: number | ((previous: number) => number)) => void;
  setStatus: (next: ScreenStatus) => void;
  setOpenDropdown: (next: FilterDropdownType) => void;
  setSelectedProjects: (next: string[]) => void;
  setSelectedEnvs: (next: string[]) => void;
  setStatsPeriod: (next: string) => void;
  setSort: (next: string) => void;
  setDetailOpen: (next: boolean | ((previous: boolean) => boolean)) => void;
  setSearchQuery: (next: string) => void;
  /** Focus the search input, stashing the current value for Escape to revert to. */
  focusSearch: () => void;
  /** Commit the typed query and hand focus back to the list. */
  submitSearch: () => void;
  /** Abandon the edit and restore the stashed value. */
  cancelSearch: () => void;
  /** The input lost focus natively (a click elsewhere) — revert unless handled. */
  handleSearchBlur: () => void;
}

export interface ScreenStateStore {
  /** The slice belonging to the screen passed in. */
  active: ScreenState;
  /**
   * Drop everything scoped to the current organization — rows, cursors, and
   * the environment filters, whose names mean nothing in another org. Project
   * filters start from the new org's remembered selection. Queries and periods
   * are org-independent and survive.
   */
  resetOrgScoped: (selectedProjects?: readonly string[]) => void;
  /**
   * Start a slice from a known set of filters, dropping whatever it held.
   *
   * What a pushed view's `initialState` goes through: opening a saved search
   * means showing *its* query and filters, not the ones the last view left in
   * the slice.
   */
  seed: (key: string, values: ScreenStateSeed) => void;
}

/** Filters a slice can be started from. */
export interface ScreenStateSeed {
  query?: string;
  sort?: string;
  statsPeriod?: string;
  selectedProjects?: string[];
  selectedEnvs?: string[];
}

/** Rows of a slice, typed by the screen that owns them. */
export function rowsOf<T>(state: ScreenState): readonly T[] {
  return state.entries as readonly T[];
}

const UNREGISTERED_KEY = "__unregistered__";

function initialData(key: string, selectedProjects: readonly string[] = []): ScreenStateData {
  const defaults = defaultsForStateKey(key);
  const query = defaults.query ?? "";
  return {
    entries: [],
    selected: 0,
    status: { loading: false },
    openDropdown: null,
    selectedProjects: [...selectedProjects],
    selectedEnvs: [],
    statsPeriod: defaults.statsPeriod ?? DEFAULT_STATS_PERIOD,
    sort: defaults.sort ?? DEFAULT_SORT,
    detailOpen: false,
    searchQuery: query,
    committedQuery: query,
    searchFocused: false,
    queryBeforeEdit: query,
  };
}

function sameStatus(a: ScreenStatus, b: ScreenStatus): boolean {
  return a.loading === b.loading && a.since === b.since && a.error === b.error && a.noun === b.noun;
}

/**
 * State for whatever the content pane is showing, and for everything it isn't.
 *
 * @param stateKey The active slice: `stateKeyOf(screen)`, or a pushed view's
 *   own `stateKey`. `undefined` for a nav destination with no registered
 *   screen — a dynamic starred-query item, say, which renders the placeholder
 *   pane and needs somewhere inert to put its state.
 */
export function useScreenState(
  stateKey: string | undefined,
  initialSelectedProjects: readonly string[] = [],
): ScreenStateStore {
  const [states, setStates] = useState<ReadonlyMap<string, ScreenStateData>>(() => new Map());
  const key = stateKey ?? UNREGISTERED_KEY;
  const initialSelectedProjectsRef = useRef(initialSelectedProjects);
  initialSelectedProjectsRef.current = initialSelectedProjects;

  /**
   * Guards the native blur handler against reverting a query that submit or
   * cancel has already dealt with. One flag, not one per screen: only one
   * input can hold focus at a time.
   */
  const searchExitHandled = useRef(false);

  const patch = useCallback(
    (target: string, update: (current: ScreenStateData) => ScreenStateData) => {
      setStates((previous) => {
        const current =
          previous.get(target) ?? initialData(target, initialSelectedProjectsRef.current);
        const next = update(current);
        if (next === current && previous.has(target)) return previous;
        const map = new Map(previous);
        map.set(target, next);
        return map;
      });
    },
    [],
  );

  // Setters are built once per key and cached: a screen's `useEffect` may list
  // `setStatus` in its dependencies, and a fresh closure each render would
  // re-run that effect forever.
  const setters = useRef(new Map<string, Setters>());
  const settersFor = useCallback(
    (target: string): Setters => {
      const cached = setters.current.get(target);
      if (cached) return cached;
      const built = buildSetters(target, patch, searchExitHandled);
      setters.current.set(target, built);
      return built;
    },
    [patch],
  );

  const data = useMemo(
    () => states.get(key) ?? initialData(key, initialSelectedProjects),
    [states, key, initialSelectedProjects],
  );

  const active = useMemo<ScreenState>(
    () => ({ ...data, key, ...settersFor(key) }),
    [data, key, settersFor],
  );

  const resetOrgScoped = useCallback((selectedProjects: readonly string[] = []) => {
    setStates((previous) => {
      const map = new Map<string, ScreenStateData>();
      for (const [k, value] of previous) {
        map.set(k, {
          ...value,
          entries: [],
          selected: 0,
          selectedProjects: [...selectedProjects],
          selectedEnvs: [],
          openDropdown: null,
          status: { loading: false },
        });
      }
      return map;
    });
  }, []);

  const seed = useCallback((target: string, values: ScreenStateSeed) => {
    setStates((previous) => {
      const base = initialData(target);
      const query = values.query ?? base.searchQuery;
      const map = new Map(previous);
      map.set(target, {
        ...base,
        searchQuery: query,
        committedQuery: query,
        queryBeforeEdit: query,
        sort: values.sort ?? base.sort,
        statsPeriod: values.statsPeriod ?? base.statsPeriod,
        selectedProjects: values.selectedProjects ?? base.selectedProjects,
        selectedEnvs: values.selectedEnvs ?? base.selectedEnvs,
      });
      return map;
    });
  }, []);

  return { active, resetOrgScoped, seed };
}

type Patch = (target: string, update: (current: ScreenStateData) => ScreenStateData) => void;

type Setters = Omit<ScreenState, keyof ScreenStateData | "key">;

function buildSetters(key: string, patch: Patch, searchExitHandled: { current: boolean }): Setters {
  const on = (update: (current: ScreenStateData) => ScreenStateData) => patch(key, update);

  /** Revert the input to the value stashed when editing began. */
  const revert = (current: ScreenStateData): ScreenStateData => ({
    ...current,
    searchQuery: current.queryBeforeEdit,
    searchFocused: false,
  });

  return {
    setEntries: (next) =>
      on((current) => {
        const rows = typeof next === "function" ? next(current.entries) : next;
        if (current.entries === rows) return current;
        // Clamp rather than reset: a refresh shouldn't move the cursor off the
        // row the user was looking at.
        const selected = Math.min(current.selected, Math.max(0, rows.length - 1));
        return { ...current, entries: rows, selected };
      }),
    setSelected: (next) =>
      on((current) => {
        const value = typeof next === "function" ? next(current.selected) : next;
        const clamped = Math.max(0, Math.min(value, Math.max(0, current.entries.length - 1)));
        return clamped === current.selected ? current : { ...current, selected: clamped };
      }),
    setStatus: (next) =>
      on((current) => (sameStatus(current.status, next) ? current : { ...current, status: next })),
    setOpenDropdown: (next) =>
      on((current) =>
        current.openDropdown === next ? current : { ...current, openDropdown: next },
      ),
    setSelectedProjects: (next) => on((current) => ({ ...current, selectedProjects: next })),
    setSelectedEnvs: (next) => on((current) => ({ ...current, selectedEnvs: next })),
    setStatsPeriod: (next) =>
      on((current) => (current.statsPeriod === next ? current : { ...current, statsPeriod: next })),
    setSort: (next) =>
      on((current) => (current.sort === next ? current : { ...current, sort: next })),
    setDetailOpen: (next) =>
      on((current) => {
        const value = typeof next === "function" ? next(current.detailOpen) : next;
        return value === current.detailOpen ? current : { ...current, detailOpen: value };
      }),
    setSearchQuery: (next) =>
      on((current) => (current.searchQuery === next ? current : { ...current, searchQuery: next })),
    focusSearch: () =>
      on((current) => ({
        ...current,
        queryBeforeEdit: current.searchQuery,
        searchFocused: true,
      })),
    submitSearch: () => {
      searchExitHandled.current = true;
      on((current) => ({
        ...current,
        committedQuery: current.searchQuery,
        searchFocused: false,
      }));
    },
    cancelSearch: () => {
      searchExitHandled.current = true;
      on(revert);
    },
    handleSearchBlur: () => {
      if (searchExitHandled.current) {
        searchExitHandled.current = false;
        return;
      }
      on(revert);
    },
  };
}
