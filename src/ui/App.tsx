import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { SentryClient } from "~/api/client";
import { writeConfig } from "~/api/config";
import { DEFAULT_SORT, DEFAULT_STATS_PERIOD, getOrganization, type SortOption } from "~/api/issues";
import { DEFAULT_LOG_PERIOD, type LogEntry } from "~/api/logs";
import type { Group } from "~/api/types";
import { matchesCommand } from "~/core/commands";
import { ALL_VIEWS_LABEL, DEFAULT_ISSUE_VIEW, getIssueView } from "~/core/issueViews";
import { getNavGroup, NAV_GROUPS, type NavGroupId } from "~/core/nav";
import { buildPaletteActions, type PaletteAction } from "~/core/palette";
import { theme } from "~/core/theme";
import { findTriageAction, TRIAGE_ACTIONS } from "~/core/triage";
import { CommandPalette } from "~/ui/components/CommandPalette";
import { HelpDialog } from "~/ui/components/HelpDialog";
import {
  NavRail,
  NAV_RAIL_WIDTH,
  ORG_HEADER_ANCHOR_LEFT,
  ORG_HEADER_ANCHOR_TOP,
} from "~/ui/components/NavRail";
import { OrgPicker } from "~/ui/components/OrgPicker";
import { SecondaryNav, SECONDARY_NAV_WIDTH } from "~/ui/components/SecondaryNav";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import type { FilterDropdownType } from "~/ui/components/FilterBar";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { useTriage } from "~/ui/hooks/useTriage";
import { IssueDetail } from "~/ui/screens/IssueDetail";
import { IssueStream } from "~/ui/screens/IssueStream";
import { IssueViewsList, type SavedViewRow } from "~/ui/screens/IssueViewsList";
import { LogStream } from "~/ui/screens/LogStream";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";

const REGIONS = ["nav", "secondary", "content"] as const;
type Region = (typeof REGIONS)[number];

export interface AppProps {
  onQuit: () => void;
  client?: SentryClient | null;
  org?: string;
}

interface StreamStatus {
  loading: boolean;
  elapsedMs?: number;
  error?: string;
}

export function App({ onQuit, client = null, org: initialOrg = "" }: AppProps) {
  const { width, height } = useTerminalDimensions();

  // The open organization. Sourced from the CLI at startup, then owned here so
  // the picker can repoint every screen at once — every fetch in the tree takes
  // it as a dependency.
  const [org, setOrg] = useState(initialOrg);

  // Rail cursor: which group is highlighted on the nav rail.
  const [railGroup, setRailGroup] = useState<NavGroupId>("issues");

  // Active selection: what the content pane renders. Default: Issues › Feed.
  const [activeGroup, setActiveGroup] = useState<NavGroupId>("issues");
  const [activeItem, setActiveItem] = useState("Feed");

  // Secondary nav: visible only after pressing Enter on the rail.
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondaryItem, setSecondaryItem] = useState("Feed");

  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();

  // One counter drives every fetch on screen: bumping it re-runs the data
  // hooks' effects, so refresh stays a single command rather than one
  // per-screen callback wired back up the tree.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  // Fetch org details (including avatar) for whichever org is open.
  useEffect(() => {
    // Drop the previous org's avatar immediately — the wrong face in the rail
    // is worse than none while the new one loads.
    setAvatarUrl(undefined);
    if (!client || !org) return;
    const controller = new AbortController();
    getOrganization(client, { org, signal: controller.signal })
      .then((orgData) => {
        if (orgData.avatar?.avatarUrl) setAvatarUrl(orgData.avatar.avatarUrl);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [client, org]);
  const [issues, setIssues] = useState<Group[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<StreamStatus>({ loading: false });
  // A view stack rather than a router: Enter pushes a detail view, Esc pops.
  const [openIssue, setOpenIssue] = useState<Group | null>(null);
  const focus = useFocusRing<Region>(REGIONS, "content");

  // Filter state.
  const [openDropdown, setOpenDropdown] = useState<FilterDropdownType>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedEnvs, setSelectedEnvs] = useState<string[]>([]);
  const [statsPeriod, setStatsPeriod] = useState(DEFAULT_STATS_PERIOD);

  // Search bar state — the query is owned here so it survives navigation and
  // is sent to the API as the user edits it.
  const [searchQuery, setSearchQuery] = useState<string>(DEFAULT_ISSUE_VIEW.query);
  const [searchFocused, setSearchFocused] = useState(false);
  /** The committed query — what was last submitted (Enter / Escape). */
  const [committedQuery, setCommittedQuery] = useState<string>(DEFAULT_ISSUE_VIEW.query);
  /** Stash the query value before editing so Escape can revert. */
  const queryBeforeEdit = useRef<string>(DEFAULT_ISSUE_VIEW.query);
  /** Sort sent with the issue query — a view can carry its own. */
  const [sort, setSort] = useState<SortOption>(DEFAULT_ISSUE_VIEW.sort ?? DEFAULT_SORT);

  // Saved views (Issues › All Views): the list's cursor, its rows, and the one
  // that's been opened. A non-null `savedView` means the stream is showing that
  // saved search rather than the list.
  const [savedViewRows, setSavedViewRows] = useState<SavedViewRow[]>([]);
  const [savedViewSelected, setSavedViewSelected] = useState(0);
  const [savedView, setSavedView] = useState<SavedViewRow | null>(null);
  const [savedViewStatus, setSavedViewStatus] = useState<StreamStatus>({ loading: false });

  const [transientNotice, setTransientNotice] = useState<Notice | null>(null);

  // Logs state, parallel to issues.
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logSelected, setLogSelected] = useState(0);
  const [logStatus, setLogStatus] = useState<StreamStatus>({ loading: false });
  // Whether the log detail panel is open. Held here rather than in the screen
  // so the status bar can name the key that closes it.
  const [logDetailOpen, setLogDetailOpen] = useState(false);

  // Log-specific filter state.
  const [logOpenDropdown, setLogOpenDropdown] = useState<FilterDropdownType>(null);
  const [logSelectedProjects, setLogSelectedProjects] = useState<string[]>([]);
  const [logSelectedEnvs, setLogSelectedEnvs] = useState<string[]>([]);
  const [logStatsPeriod, setLogStatsPeriod] = useState(DEFAULT_LOG_PERIOD);

  // Log search bar state.
  const [logSearchQuery, setLogSearchQuery] = useState<string>("");
  const [logSearchFocused, setLogSearchFocused] = useState(false);
  const [logCommittedQuery, setLogCommittedQuery] = useState<string>("");
  const logQueryBeforeEdit = useRef<string>("");

  // Which Issues view is on screen. A saved view outranks the nav item, since
  // opening one is a step *inside* All Views rather than a nav change.
  const navView = activeGroup === "issues" ? getIssueView(activeItem) : undefined;
  const streamTitle = savedView ? savedView.view.name : navView?.label;
  const streamDescription = savedView ? savedView.view.query : navView?.description;

  const showIssues = navView !== undefined || savedView !== null;
  const showAllViews = activeGroup === "issues" && activeItem === ALL_VIEWS_LABEL && !savedView;
  const showLogs = activeGroup === "explore" && activeItem === "Logs";
  const anySearchFocused = searchFocused || logSearchFocused;

  /** Focus the search input, stashing the current query for Escape revert. */
  const focusSearch = useCallback(() => {
    if (showLogs) {
      logQueryBeforeEdit.current = logSearchQuery;
      setLogSearchFocused(true);
    } else {
      queryBeforeEdit.current = searchQuery;
      setSearchFocused(true);
    }
  }, [searchQuery, logSearchQuery, showLogs]);

  /** Guards against the native blur handler reverting after submit/cancel. */
  const searchExitHandled = useRef(false);

  /** Submit the search query and return focus to the content pane. */
  const submitSearch = useCallback(() => {
    searchExitHandled.current = true;
    if (showLogs) {
      setLogCommittedQuery(logSearchQuery);
      setLogSearchFocused(false);
    } else {
      setCommittedQuery(searchQuery);
      setSearchFocused(false);
    }
  }, [searchQuery, logSearchQuery, showLogs]);

  /** Cancel editing — revert to the last committed query. */
  const cancelSearch = useCallback(() => {
    searchExitHandled.current = true;
    if (showLogs) {
      setLogSearchQuery(logQueryBeforeEdit.current);
      setLogSearchFocused(false);
    } else {
      setSearchQuery(queryBeforeEdit.current);
      setSearchFocused(false);
    }
  }, [showLogs]);

  /** Handle native blur (e.g. clicking away) — revert unless already handled. */
  const handleSearchBlur = useCallback(() => {
    if (searchExitHandled.current) {
      searchExitHandled.current = false;
      return;
    }
    if (showLogs) {
      setLogSearchQuery(logQueryBeforeEdit.current);
      setLogSearchFocused(false);
    } else {
      setSearchQuery(queryBeforeEdit.current);
      setSearchFocused(false);
    }
  }, [showLogs]);

  /** Focus the log search input. */
  const focusLogSearch = useCallback(() => {
    logQueryBeforeEdit.current = logSearchQuery;
    setLogSearchFocused(true);
  }, [logSearchQuery]);

  /** Handle native blur for log search. */
  const handleLogSearchBlur = useCallback(() => {
    if (searchExitHandled.current) {
      searchExitHandled.current = false;
      return;
    }
    setLogSearchQuery(logQueryBeforeEdit.current);
    setLogSearchFocused(false);
  }, []);

  const handleIssues = useCallback((next: Group[]) => {
    setIssues(next);
    // Clamp rather than reset: a refresh shouldn't move the cursor off the row
    // the user was looking at.
    setSelected((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, []);

  const handleLogs = useCallback((next: LogEntry[]) => {
    setLogEntries(next);
    setLogSelected((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, []);

  /** Replace one issue in place — used for the optimistic write and rollback. */
  const replaceIssue = useCallback((next: Group) => {
    setIssues((current) => current.map((g) => (g.id === next.id ? next : g)));
    setOpenIssue((current) => (current && current.id === next.id ? next : current));
  }, []);

  // Notices about something the user just did are transient: they announce the
  // action, then get out of the way so the ambient load notice is visible again.
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showNotice = useCallback((notice: Notice) => {
    setTransientNotice(notice);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setTransientNotice(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  /**
   * Point the whole app at a different organization.
   *
   * Everything on screen is org-scoped, so the loaded rows and the project and
   * environment filters are dropped rather than carried across — a project slug
   * from the old org selects nothing in the new one. The choice is persisted as
   * the new default, matching what `--org` writes on first run.
   */
  const switchOrg = useCallback(
    (slug: string) => {
      setShowOrgPicker(false);
      if (!slug || slug === org) return;

      setOrg(slug);
      setOpenIssue(null);
      setIssues([]);
      setSelected(0);
      setSelectedProjects([]);
      setSelectedEnvs([]);
      setLogEntries([]);
      setLogSelected(0);
      setLogSelectedProjects([]);
      setLogSelectedEnvs([]);
      showNotice({ kind: "info", text: `switched to ${slug}` });

      void writeConfig({ org: slug }).catch(() => {
        // A read-only config dir shouldn't undo a switch that already happened;
        // it only means the next launch opens the previous org.
      });
    },
    [org, showNotice],
  );

  const triage = useTriage(client, org, {
    onOptimistic: replaceIssue,
    onNotice: showNotice,
  });

  // The row the keyboard acts on: the open issue, else the list cursor. The
  // list survives navigating away, so the cursor only counts while the issue
  // stream is the thing on screen — otherwise `r` on the log view would
  // resolve an issue nobody can see.
  const activeIssue = openIssue ?? (showIssues ? issues[selected] : undefined);

  /**
   * Open a nav group's secondary list — the one path Enter on the rail and a
   * click on a rail item both take.
   */
  const openNavGroup = useCallback(
    (group: NavGroupId) => {
      setRailGroup(group);
      // Re-entering the active group starts on the current item.
      const startItem =
        group === activeGroup ? activeItem : (getNavGroup(group).sections[0]?.items[0] ?? "");
      setSecondaryItem(startItem);
      setShowSecondary(true);
      focus.focus("secondary");
    },
    [activeGroup, activeItem, focus],
  );

  /**
   * Show a group's item in the content pane — the one path every way of
   * navigating ends at: the secondary nav, a click, and the command palette.
   */
  const navigateTo = useCallback(
    (group: NavGroupId, item: string) => {
      setRailGroup(group);
      setActiveGroup(group);
      setActiveItem(item);
      setSecondaryItem(item);
      setShowSecondary(false);
      // Navigating away supersedes whatever detail view is on the stack;
      // otherwise the detail keeps rendering over the group just chosen.
      setOpenIssue(null);
      setLogDetailOpen(false);
      // …and supersedes an opened saved view, for the same reason.
      setSavedView(null);
      // Each Issues item is its own query, so selecting one resets the search
      // bar to that view's default. Done here rather than in an effect so it
      // can never overwrite a query the user is part-way through editing.
      const view = group === "issues" ? getIssueView(item) : undefined;
      if (view) {
        setSearchQuery(view.query);
        setCommittedQuery(view.query);
        queryBeforeEdit.current = view.query;
        setSort(view.sort ?? DEFAULT_SORT);
      }
      focus.focus("content");
    },
    [focus],
  );

  /**
   * Commit a secondary nav item as the active view — shared by Enter on the
   * secondary cursor and a click on a secondary item.
   */
  const selectNavItem = useCallback(
    (item: string) => navigateTo(railGroup, item),
    [railGroup, navigateTo],
  );

  const paletteActions = useMemo(
    () =>
      buildPaletteActions({
        streamView: (showIssues || showLogs) && !openIssue,
        hasIssue: Boolean(activeIssue),
      }),
    [showIssues, showLogs, openIssue, activeIssue],
  );

  /**
   * Run what the palette selected, then close it.
   *
   * Every branch reuses the callback the key binding already goes through, so
   * a command can't behave one way from the keyboard and another from `ctrl+k`.
   */
  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      setShowPalette(false);
      if (action.target.kind === "nav") {
        navigateTo(action.target.group, action.target.item);
        return;
      }

      const { commandId } = action.target;
      const openFilter = showLogs ? setLogOpenDropdown : setOpenDropdown;
      switch (commandId) {
        case "sentry.app.quit":
          onQuit();
          return;
        case "sentry.app.help":
          setShowHelp(true);
          return;
        case "sentry.app.refresh":
          refresh();
          return;
        case "sentry.app.switchOrg":
          setShowOrgPicker(true);
          return;
        case "sentry.nav.search":
          focus.focus("content");
          focusSearch();
          return;
        case "sentry.view.filterProject":
          focus.focus("content");
          openFilter("project");
          return;
        case "sentry.view.filterEnv":
          focus.focus("content");
          openFilter("env");
          return;
        case "sentry.view.filterDate":
          focus.focus("content");
          openFilter("date");
          return;
        default:
          // The remaining palette-scoped commands are all triage actions; the
          // catalog only offers them when there is an issue to act on.
          if (findTriageAction(commandId) && activeIssue) triage.run(commandId, activeIssue);
      }
    },
    [activeIssue, focus, focusSearch, navigateTo, onQuit, refresh, showLogs, triage],
  );

  /**
   * Mouse handling for an issue row: the first click puts the cursor on the
   * row, a second click on that same row opens it. Two steps rather than one,
   * because a stray click in a list is cheap to recover from only while it
   * moves a cursor — and it mirrors the rail, where a click picks a group and
   * a click in the list beside it commits.
   */
  const handleRowClick = useCallback(
    (index: number, group: Group) => {
      // A click that arrives while the list is unfocused is the one that
      // focuses it, so it can only ever select — the cursor it would be
      // "confirming" wasn't on screen to be aimed at.
      const confirming = focus.focusedRef.current === "content" && index === selected;
      setSelected(index);
      // The secondary nav is a drawer over the nav rail; acting in the content
      // pane closes it, exactly as choosing an item from it does.
      setShowSecondary(false);
      focus.focus("content");
      if (confirming) setOpenIssue(group);
    },
    [focus, selected],
  );

  /** Open a saved view: show its results in the stream instead of the list. */
  const openSavedView = useCallback((row: SavedViewRow) => {
    setSavedView(row);
    setSearchQuery(row.view.query);
    setCommittedQuery(row.view.query);
    queryBeforeEdit.current = row.view.query;
    setSort(row.view.querySort ?? DEFAULT_SORT);
    setStatsPeriod(row.statsPeriod);
    setSelectedProjects(row.projectSlugs);
    setSelectedEnvs(row.view.environments);
  }, []);

  const handleSavedViewRows = useCallback((rows: SavedViewRow[]) => {
    setSavedViewRows(rows);
    setSavedViewSelected((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, []);

  useKeyboard((key) => {
    routeKeyOwnership(
      [
        // 0. The palette owns every key while open. It runs its own listener
        // for the cursor and Enter, and everything it doesn't claim is text
        // for its query input — so this handler only has to end the chain.
        () => (showPalette ? "focused" : "notMine"),
        // 1. Overlays swallow everything while open.
        () => {
          if (!showHelp) return "notMine";
          if (matchesCommand("sentry.nav.back", key) || matchesCommand("sentry.app.help", key)) {
            setShowHelp(false);
          }
          return "mine";
        },
        // 1b. Filter dropdowns swallow keys while open — the Dropdown
        // component handles its own navigation via a separate useKeyboard.
        // Returning "focused" stops this routing chain so later handlers
        // (e.g. issue list cursor) don't steal j/k, while still letting the
        // Dropdown's global listener fire.
        () => {
          if (!openDropdown && !logOpenDropdown && !showOrgPicker) return "notMine";
          return "focused";
        },
        // 1c. The palette opens from anywhere, including mid-edit in the
        // search box — so it is claimed ahead of the handler that would
        // otherwise hand the chord to the focused input.
        () => {
          if (!matchesCommand("sentry.app.commandPalette", key)) return "notMine";
          if (anySearchFocused) cancelSearch();
          setShowPalette(true);
          return "mine";
        },
        // 2. Search input intercepts Escape (cancel) and Enter (submit);
        //    all other keys pass through to the focused <input>.
        () => {
          if (!anySearchFocused) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            cancelSearch();
            return "mine";
          }
          if (matchesCommand("sentry.nav.open", key)) {
            submitSearch();
            return "mine";
          }
          // Let the focused input renderable handle all other keystrokes.
          return "focused";
        },
        // 3. The detail view owns Escape (back) before anything else claims it.
        () => {
          if (!openIssue) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            setOpenIssue(null);
            return "mine";
          }
          return "notMine";
        },
        // 3b. Escape backs out of an opened saved view to the All Views list.
        //     Sits below the detail view so Escape pops one level at a time.
        () => {
          if (!savedView) return "notMine";
          if (showSecondary) return "notMine";
          if (!matchesCommand("sentry.nav.back", key)) return "notMine";
          setSavedView(null);
          focus.focus("content");
          return "mine";
        },
        // 4. Escape closes the secondary nav and returns focus to the rail.
        () => {
          if (!showSecondary) return "notMine";
          if (matchesCommand("sentry.nav.back", key)) {
            setShowSecondary(false);
            focus.focus("nav");
            return "mine";
          }
          return "notMine";
        },
        // 5. Global app commands. Tab cycles only through visible regions.
        () => {
          // Filter dropdown shortcuts — available for both issues and logs.
          if ((showIssues || showLogs) && !openIssue && focus.focusedRef.current === "content") {
            const setDropdown = showLogs ? setLogOpenDropdown : setOpenDropdown;
            if (matchesCommand("sentry.view.filterProject", key)) {
              setDropdown("project");
              return "mine";
            }
            if (matchesCommand("sentry.view.filterEnv", key)) {
              setDropdown("env");
              return "mine";
            }
            if (matchesCommand("sentry.view.filterDate", key)) {
              setDropdown("date");
              return "mine";
            }
          }
          if (matchesCommand("sentry.app.help", key)) {
            setShowHelp(true);
            return "mine";
          }
          if (matchesCommand("sentry.app.refresh", key)) {
            refresh();
            return "mine";
          }
          if (matchesCommand("sentry.app.switchOrg", key)) {
            setShowOrgPicker(true);
            return "mine";
          }
          if (matchesCommand("sentry.app.quit", key)) {
            onQuit();
            return "mine";
          }
          if (matchesCommand("sentry.app.focusNext", key)) {
            const cur = focus.focusedRef.current;
            if (showSecondary) {
              focus.focus(cur === "nav" ? "secondary" : "nav");
            } else {
              focus.focus(cur === "nav" ? "content" : "nav");
            }
            return "mine";
          }
          if (matchesCommand("sentry.app.focusPrev", key)) {
            const cur = focus.focusedRef.current;
            if (showSecondary) {
              focus.focus(cur === "secondary" ? "nav" : "secondary");
            } else {
              focus.focus(cur === "content" ? "nav" : "content");
            }
            return "mine";
          }
          return "notMine";
        },
        // 6. Triage actions, valid in both the list and the detail view.
        () => {
          if (!activeIssue) return "notMine";
          // In the list these belong to the content pane; the nav panes keep
          // their own j/k. In the detail view there is only one issue, so no
          // focus check is needed.
          if (!openIssue && focus.focusedRef.current !== "content") {
            return "notMine";
          }
          for (const action of TRIAGE_ACTIONS) {
            if (matchesCommand(action.commandId, key)) {
              triage.run(action.commandId, activeIssue);
              return "mine";
            }
          }
          return "notMine";
        },
        // 7. Nav rail: j/k moves the cursor, Enter opens secondary nav.
        () => {
          if (openIssue) return "notMine";
          if (focus.focusedRef.current !== "nav") return "notMine";
          if (matchesCommand("sentry.nav.open", key)) {
            openNavGroup(railGroup);
            return "mine";
          }
          const index = NAV_GROUPS.findIndex((g) => g.id === railGroup);
          const step = matchesCommand("sentry.nav.down", key)
            ? 1
            : matchesCommand("sentry.nav.up", key)
              ? -1
              : 0;
          if (step === 0) return "notMine";
          const next = NAV_GROUPS[(index + step + NAV_GROUPS.length) % NAV_GROUPS.length]!;
          setRailGroup(next.id);
          return "mine";
        },
        // 8. Secondary nav: j/k moves the cursor, Enter selects and closes.
        () => {
          if (openIssue) return "notMine";
          if (!showSecondary) return "notMine";
          if (focus.focusedRef.current !== "secondary") return "notMine";
          const items = getNavGroup(railGroup).sections.flatMap((s) => s.items);
          const index = items.indexOf(secondaryItem);
          if (matchesCommand("sentry.nav.open", key)) {
            selectNavItem(secondaryItem);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setSecondaryItem(items[Math.min(index + 1, items.length - 1)] ?? secondaryItem);
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setSecondaryItem(items[Math.max(index - 1, 0)] ?? secondaryItem);
            return "mine";
          }
          return "notMine";
        },
        // 9. `/` focuses the search bar from the content pane.
        () => {
          if (openIssue) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          if (matchesCommand("sentry.nav.search", key)) {
            focusSearch();
            return "mine";
          }
          return "notMine";
        },
        // 10. Issue list cursor and open.
        () => {
          if (openIssue) return "notMine";
          if (focus.focusedRef.current !== "content") return "notMine";
          if (!showIssues) return "notMine";
          const last = Math.max(0, issues.length - 1);
          if (matchesCommand("sentry.nav.open", key)) {
            const target = issues[selected];
            if (target) setOpenIssue(target);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setSelected((i) => Math.min(i + 1, last));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setSelected((i) => Math.max(i - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            setSelected(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            setSelected(last);
            return "mine";
          }
          return "notMine";
        },
        // 11. Saved-view list cursor and open.
        () => {
          if (focus.focusedRef.current !== "content") return "notMine";
          if (!showAllViews) return "notMine";
          const last = Math.max(0, savedViewRows.length - 1);
          if (matchesCommand("sentry.nav.open", key)) {
            const target = savedViewRows[savedViewSelected];
            if (target) openSavedView(target);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setSavedViewSelected((i) => Math.min(i + 1, last));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setSavedViewSelected((i) => Math.max(i - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            setSavedViewSelected(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            setSavedViewSelected(last);
            return "mine";
          }
          return "notMine";
        },
        // 12. Log list cursor navigation, and the detail panel it opens.
        () => {
          if (focus.focusedRef.current !== "content") return "notMine";
          if (!showLogs) return "notMine";
          const last = Math.max(0, logEntries.length - 1);
          if (matchesCommand("sentry.nav.open", key)) {
            // Toggle rather than push: the cursor keys keep working while the
            // panel is open, so there is no view to pop back out of.
            setLogDetailOpen((open) => !open);
            return "mine";
          }
          if (logDetailOpen && matchesCommand("sentry.nav.back", key)) {
            setLogDetailOpen(false);
            return "mine";
          }
          if (matchesCommand("sentry.nav.down", key)) {
            setLogSelected((i) => Math.min(i + 1, last));
            return "mine";
          }
          if (matchesCommand("sentry.nav.up", key)) {
            setLogSelected((i) => Math.max(i - 1, 0));
            return "mine";
          }
          if (matchesCommand("sentry.nav.top", key)) {
            setLogSelected(0);
            return "mine";
          }
          if (matchesCommand("sentry.nav.bottom", key)) {
            setLogSelected(last);
            return "mine";
          }
          return "notMine";
        },
      ],
      key,
      consumeKey,
    );
  });

  const secondaryWidth = showSecondary ? SECONDARY_NAV_WIDTH : 0;
  const contentWidth = Math.max(20, width - NAV_RAIL_WIDTH - secondaryWidth - 2);
  const contentHeight = Math.max(3, height - 3);

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.bg,
      }}
    >
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <NavRail
          active={railGroup}
          focused={focus.isFocused("nav")}
          avatarUrl={avatarUrl}
          orgSlug={org}
          onSelect={openNavGroup}
          onOrgPress={() => setShowOrgPicker(true)}
        />
        {showSecondary ? (
          <SecondaryNav
            group={railGroup}
            activeItem={secondaryItem}
            focused={focus.isFocused("secondary")}
            onSelect={selectNavItem}
          />
        ) : null}
        <box
          style={{
            flexGrow: 1,
            flexDirection: "column",
            // Clip rather than letting an over-tall screen paint over the
            // pane's bottom border and the status bar below it.
            overflow: "hidden",
            border: true,
            borderColor:
              focus.isFocused("content") && !anySearchFocused ? theme.borderFocused : theme.border,
          }}
        >
          {openIssue ? (
            <IssueDetail
              client={client}
              org={org}
              group={openIssue}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
              reloadToken={reloadToken}
            />
          ) : showIssues ? (
            <IssueStream
              client={client}
              org={org}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
              selectedIndex={selected}
              onIssuesChange={handleIssues}
              onStatusChange={setStatus}
              // Once loaded, the App owns the list so optimistic triage edits
              // survive; before that the stream renders its own fetch state.
              issuesOverride={issues.length > 0 ? issues : undefined}
              pendingIds={triage.pending}
              openDropdown={openDropdown}
              selectedProjects={selectedProjects}
              selectedEnvs={selectedEnvs}
              statsPeriod={statsPeriod}
              onProjectChange={setSelectedProjects}
              onEnvChange={setSelectedEnvs}
              onPeriodChange={setStatsPeriod}
              onDropdownClose={() => setOpenDropdown(null)}
              onDropdownOpen={setOpenDropdown}
              query={committedQuery}
              searchValue={searchQuery}
              onSearchInput={setSearchQuery}
              searchFocused={searchFocused}
              onSearchFocus={focusSearch}
              onSearchBlur={handleSearchBlur}
              reloadToken={reloadToken}
              onRowClick={handleRowClick}
              sort={sort}
              title={streamTitle}
              description={streamDescription}
            />
          ) : showAllViews ? (
            <IssueViewsList
              client={client}
              org={org}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
              selectedIndex={savedViewSelected}
              onRowsChange={handleSavedViewRows}
              onStatusChange={setSavedViewStatus}
              reloadToken={reloadToken}
            />
          ) : showLogs ? (
            <LogStream
              client={client}
              org={org}
              width={contentWidth}
              height={contentHeight}
              focused={focus.isFocused("content")}
              selectedIndex={logSelected}
              onLogsChange={handleLogs}
              onStatusChange={setLogStatus}
              openDropdown={logOpenDropdown}
              selectedProjects={logSelectedProjects}
              selectedEnvs={logSelectedEnvs}
              statsPeriod={logStatsPeriod}
              onProjectChange={setLogSelectedProjects}
              onEnvChange={setLogSelectedEnvs}
              onPeriodChange={setLogStatsPeriod}
              onDropdownClose={() => setLogOpenDropdown(null)}
              onDropdownOpen={setLogOpenDropdown}
              query={logCommittedQuery}
              searchValue={logSearchQuery}
              onSearchInput={setLogSearchQuery}
              searchFocused={logSearchFocused}
              onSearchFocus={focusLogSearch}
              onSearchBlur={handleLogSearchBlur}
              reloadToken={reloadToken}
              detailOpen={logDetailOpen}
            />
          ) : (
            <box style={{ flexDirection: "column", paddingLeft: 1 }}>
              <text fg={theme.text} attributes={1}>
                {`${getNavGroup(activeGroup).label} › ${activeItem}`}
              </text>
              <text fg={theme.muted}>Not implemented yet.</text>
            </box>
          )}
        </box>
      </box>

      <StatusBar
        notice={
          // A triage result or an org switch is the most recent thing the user
          // did, so it outranks the ambient load notice.
          transientNotice ??
          (openIssue
            ? { kind: "idle", text: openIssue.shortId }
            : showLogs
              ? toLogNotice(logStatus)
              : showAllViews
                ? toViewsNotice(savedViewStatus)
                : toNotice(status, showIssues))
        }
        elapsedMs={openIssue ? undefined : status.elapsedMs}
        hints={
          anySearchFocused
            ? [
                { command: "sentry.nav.open", label: "submit" },
                { command: "sentry.nav.back", label: "cancel" },
              ]
            : openIssue
              ? [
                  { command: "sentry.nav.back", label: "back" },
                  { command: "sentry.issue.resolve", label: "resolve" },
                  { command: "sentry.issue.archive", label: "archive" },
                  { command: "sentry.app.commandPalette", label: "commands" },
                  { command: "sentry.app.help", label: "help" },
                ]
              : showLogs
                ? [
                    // Enter toggles, so the one hint carries both directions.
                    { command: "sentry.nav.open", label: logDetailOpen ? "close" : "details" },
                    { command: "sentry.nav.search", label: "search" },
                    { command: "sentry.app.commandPalette", label: "commands" },
                    { command: "sentry.app.help", label: "help" },
                    { command: "sentry.app.quit", label: "quit" },
                  ]
                : [
                    { command: "sentry.nav.open", label: "open" },
                    { command: "sentry.nav.search", label: "search" },
                    { command: "sentry.app.commandPalette", label: "commands" },
                    { command: "sentry.app.help", label: "help" },
                    { command: "sentry.app.quit", label: "quit" },
                  ]
        }
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}

      {showPalette ? (
        <CommandPalette
          actions={paletteActions}
          onRun={runPaletteAction}
          onClose={() => setShowPalette(false)}
        />
      ) : null}

      {showOrgPicker ? (
        <OrgPicker
          client={client}
          currentOrg={org}
          anchorLeft={ORG_HEADER_ANCHOR_LEFT}
          anchorTop={ORG_HEADER_ANCHOR_TOP}
          onSelect={switchOrg}
          onClose={() => setShowOrgPicker(false)}
        />
      ) : null}
    </box>
  );
}

function toNotice(status: StreamStatus, showIssues: boolean): Notice {
  if (!showIssues) return { kind: "idle", text: "" };
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) return { kind: "loading", text: "loading issues…" };
  return { kind: "idle", text: "" };
}

function toLogNotice(status: StreamStatus): Notice {
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) return { kind: "loading", text: "loading logs…" };
  return { kind: "idle", text: "" };
}

function toViewsNotice(status: StreamStatus): Notice {
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) return { kind: "loading", text: "Loading views…" };
  return { kind: "idle", text: "" };
}
