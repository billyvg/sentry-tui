/**
 * Per-screen state, keyed by screen.
 *
 * Every list screen owns the same things — its rows, cursor, load status,
 * filters, detail visibility, and search state. Keeping one reducer-managed
 * slice per state key lets those values survive navigating away and back
 * without exposing a setter for every field.
 *
 * Screens that share a `stateKey` share one entry — see `src/core/screens.ts`.
 */

import { useCallback, useMemo, useReducer, useRef } from "react";

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
interface ScreenSlice {
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

/** Every atomic transition supported by one screen slice. */
export type ScreenAction =
  | {
      type: "setEntries";
      payload: readonly unknown[] | ((previous: readonly unknown[]) => readonly unknown[]);
    }
  | { type: "setSelected"; payload: number | ((previous: number) => number) }
  | { type: "setStatus"; payload: ScreenStatus }
  | { type: "setOpenDropdown"; payload: FilterDropdownType }
  | { type: "setSelectedProjects"; payload: string[] }
  | { type: "setSelectedEnvs"; payload: string[] }
  | { type: "setStatsPeriod"; payload: string }
  | { type: "setSort"; payload: string }
  | { type: "setDetailOpen"; payload: boolean | ((previous: boolean) => boolean) }
  | { type: "setSearchQuery"; payload: string }
  | { type: "focusSearch" }
  | { type: "submitSearch" }
  | { type: "cancelSearch" }
  | { type: "handleSearchBlur" }
  | { type: "resetOrgScoped"; payload: { projects: string[] } }
  | { type: "seed"; payload: ScreenStateSeed };

/**
 * One screen's slice: current values and a single stable transition function,
 * plus convenience methods for the coordinated search interactions.
 */
export interface ScreenState extends ScreenSlice {
  /** The map key this slice is stored under. */
  key: string;
  /** Apply one atomic transition to this slice. */
  dispatch: (action: ScreenAction) => void;
  /** Focus the search input, stashing the committed value for Escape to restore. */
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
   * Drop everything scoped to the current organization — rows, cursors, open
   * UI, and environment filters. Project filters start from the new org's
   * remembered selection. Queries and periods are org-independent and survive.
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

/** Build the default state for a screen key. */
function initialSlice(key: string, selectedProjects: readonly string[] = []): ScreenSlice {
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

/** Compare status values so repeated fetch effects can remain reducer no-ops. */
function sameStatus(a: ScreenStatus, b: ScreenStatus): boolean {
  return a.loading === b.loading && a.since === b.since && a.error === b.error && a.noun === b.noun;
}

/** Apply one action to a screen slice without side effects. */
function screenReducer(state: ScreenSlice, action: ScreenAction): ScreenSlice {
  switch (action.type) {
    case "setEntries": {
      const entries =
        typeof action.payload === "function" ? action.payload(state.entries) : action.payload;
      if (entries === state.entries) return state;
      // Clamp rather than reset: a refresh should keep the cursor on the row
      // the user was looking at whenever that row still exists.
      const selected = Math.min(state.selected, Math.max(0, entries.length - 1));
      return { ...state, entries, selected };
    }
    case "setSelected": {
      const selected =
        typeof action.payload === "function" ? action.payload(state.selected) : action.payload;
      const clamped = Math.max(0, Math.min(selected, Math.max(0, state.entries.length - 1)));
      return clamped === state.selected ? state : { ...state, selected: clamped };
    }
    case "setStatus":
      return sameStatus(state.status, action.payload)
        ? state
        : { ...state, status: action.payload };
    case "setOpenDropdown":
      return state.openDropdown === action.payload
        ? state
        : { ...state, openDropdown: action.payload };
    case "setSelectedProjects":
      return { ...state, selectedProjects: action.payload };
    case "setSelectedEnvs":
      return { ...state, selectedEnvs: action.payload };
    case "setStatsPeriod":
      return state.statsPeriod === action.payload
        ? state
        : { ...state, statsPeriod: action.payload };
    case "setSort":
      return state.sort === action.payload ? state : { ...state, sort: action.payload };
    case "setDetailOpen": {
      const detailOpen =
        typeof action.payload === "function" ? action.payload(state.detailOpen) : action.payload;
      return detailOpen === state.detailOpen ? state : { ...state, detailOpen };
    }
    case "setSearchQuery":
      return state.searchQuery === action.payload
        ? state
        : { ...state, searchQuery: action.payload };
    case "focusSearch":
      return {
        ...state,
        queryBeforeEdit: state.committedQuery,
        searchFocused: true,
      };
    case "submitSearch":
      return {
        ...state,
        committedQuery: state.searchQuery,
        searchFocused: false,
      };
    case "cancelSearch":
    case "handleSearchBlur":
      return {
        ...state,
        searchQuery: state.queryBeforeEdit,
        searchFocused: false,
      };
    case "resetOrgScoped":
      return {
        ...state,
        entries: [],
        selected: 0,
        status: { loading: false },
        openDropdown: null,
        selectedProjects: [...action.payload.projects],
        selectedEnvs: [],
        detailOpen: false,
        searchFocused: false,
      };
    case "seed": {
      const query = action.payload.query ?? state.searchQuery;
      return {
        ...state,
        searchQuery: query,
        committedQuery: query,
        queryBeforeEdit: query,
        sort: action.payload.sort ?? state.sort,
        statsPeriod: action.payload.statsPeriod ?? state.statsPeriod,
        selectedProjects: action.payload.selectedProjects ?? state.selectedProjects,
        selectedEnvs: action.payload.selectedEnvs ?? state.selectedEnvs,
      };
    }
  }
}

type ScreenStoreAction =
  | { type: "dispatch"; key: string; action: ScreenAction; fallback: ScreenSlice }
  | { type: "resetOrgScoped"; projects: string[] }
  | { type: "seed"; key: string; values: ScreenStateSeed };

/** Route a slice action through the map that owns all screen state. */
function screenStoreReducer(
  states: ReadonlyMap<string, ScreenSlice>,
  action: ScreenStoreAction,
): ReadonlyMap<string, ScreenSlice> {
  if (action.type === "resetOrgScoped") {
    const next = new Map<string, ScreenSlice>();
    for (const [key, state] of states) {
      next.set(
        key,
        screenReducer(state, {
          type: "resetOrgScoped",
          payload: { projects: action.projects },
        }),
      );
    }
    return next;
  }

  const next = new Map(states);
  if (action.type === "seed") {
    next.set(
      action.key,
      screenReducer(initialSlice(action.key), { type: "seed", payload: action.values }),
    );
    return next;
  }

  const current = states.get(action.key) ?? action.fallback;
  const updated = screenReducer(current, action.action);
  if (updated === current && states.has(action.key)) return states;
  next.set(action.key, updated);
  return next;
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
  initialSeed?: ScreenStateSeed,
): ScreenStateStore {
  const key = stateKey ?? UNREGISTERED_KEY;
  const [states, storeDispatch] = useReducer(
    screenStoreReducer,
    undefined,
    (): ReadonlyMap<string, ScreenSlice> =>
      initialSeed
        ? new Map([
            [
              key,
              screenReducer(initialSlice(key, initialSelectedProjects), {
                type: "seed",
                payload: initialSeed,
              }),
            ],
          ])
        : new Map(),
  );
  const initialSelectedProjectsRef = useRef(initialSelectedProjects);
  initialSelectedProjectsRef.current = initialSelectedProjects;

  /**
   * Guards the native blur handler against reverting a query that submit or
   * cancel has already dealt with. One flag, not one per screen: only one
   * input can hold focus at a time.
   */
  const searchExitHandled = useRef(false);

  const dispatch = useCallback(
    (action: ScreenAction) => {
      storeDispatch({
        type: "dispatch",
        key,
        action,
        fallback: initialSlice(key, initialSelectedProjectsRef.current),
      });
    },
    [key],
  );

  const focusSearch = useCallback(() => dispatch({ type: "focusSearch" }), [dispatch]);
  const submitSearch = useCallback(() => {
    searchExitHandled.current = true;
    dispatch({ type: "submitSearch" });
  }, [dispatch]);
  const cancelSearch = useCallback(() => {
    searchExitHandled.current = true;
    dispatch({ type: "cancelSearch" });
  }, [dispatch]);
  const handleSearchBlur = useCallback(() => {
    if (searchExitHandled.current) {
      searchExitHandled.current = false;
      return;
    }
    dispatch({ type: "handleSearchBlur" });
  }, [dispatch]);

  const data = useMemo(
    () => states.get(key) ?? initialSlice(key, initialSelectedProjects),
    [states, key, initialSelectedProjects],
  );

  const active = useMemo<ScreenState>(
    () => ({
      ...data,
      key,
      dispatch,
      focusSearch,
      submitSearch,
      cancelSearch,
      handleSearchBlur,
    }),
    [data, key, dispatch, focusSearch, submitSearch, cancelSearch, handleSearchBlur],
  );

  const resetOrgScoped = useCallback((selectedProjects: readonly string[] = []) => {
    storeDispatch({ type: "resetOrgScoped", projects: [...selectedProjects] });
  }, []);

  const seed = useCallback((target: string, values: ScreenStateSeed) => {
    storeDispatch({ type: "seed", key: target, values });
  }, []);

  return { active, resetOrgScoped, seed };
}
