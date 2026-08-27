import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { SentryClient } from "~/api/client";
import { writeConfig } from "@sentry-tui/runtime-contract/config";
import { type ReadyUpdate } from "@sentry-tui/runtime-contract/update";
import { getCurrentUser, getOrganization, type CurrentUser } from "~/api/issues";
import type { SeerCodeMode } from "~/api/seer";
import type { Group } from "~/api/types";
import { getNavGroup, NAV_GROUPS } from "~/core/nav";
import { buildPaletteActions, type PaletteAction } from "~/core/palette";
import { getScreen, stateKeyOf, type ScreenId } from "~/core/screens";
import {
  buildSentryUrl,
  parseSentryUrl,
  recordSentryUrlFailure,
  type SentryUrlFailure,
  type SentryUrlLocation,
} from "~/core/sentryUrl";
import { useTheme } from "~/ui/theme";
import { findTriageAction } from "~/core/triage";
// Aliased: `breadcrumb` is taken in this file by the trail rendered in the
// pane's border title, which is a different thing entirely.
import { breadcrumb as leaveCrumb, identify, log } from "@sentry-tui/runtime-contract/telemetry";
import { CommandPalette } from "~/ui/components/CommandPalette";
import { DetailBackRow } from "~/ui/components/DetailBackRow";
import { isFilterBarMounted } from "~/ui/components/FilterBar";
import { HelpDialog } from "~/ui/components/HelpDialog";
import { OpenSentryUrlDialog } from "~/ui/components/OpenSentryUrlDialog";
import { NavRail, ORG_HEADER_ANCHOR_LEFT, ORG_HEADER_ANCHOR_TOP } from "~/ui/components/NavRail";
import { OrgPicker } from "~/ui/components/OrgPicker";
import { SecondaryNav } from "~/ui/components/SecondaryNav";
import { StatusBar, type Notice } from "~/ui/components/StatusBar";
import { WebUrlDialog } from "~/ui/components/WebUrlDialog";
import { useFocusRing } from "~/ui/hooks/useFocusRing";
import { APP_REGIONS, useNavigation } from "~/ui/hooks/useNavigation";
import { useNavigationTrace } from "~/ui/hooks/useNavigationTrace";
import { SeerChatContext, useSeerChat } from "~/ui/hooks/useSeerChat";
import { useUpdateCheck } from "~/ui/hooks/useUpdateCheck";
import { rowsOf, type ScreenStatus } from "~/ui/hooks/useScreenState";
import { useTriage } from "~/ui/hooks/useTriage";
import { createAppKeyHandlers, FILTER_COMMAND_DROPDOWN } from "~/ui/lib/appKeyHandlers";
import type { ScreenActions } from "~/ui/screens/types";
import { consumeKey, routeKeyOwnership } from "~/ui/lib/keyRouting";
import { viewForSentryUrl } from "~/ui/sentryUrl";

export interface AppProps {
  onQuit: () => void;
  client?: SentryClient | null;
  org?: string;
  /**
   * Screen to open on, instead of Issues › Feed.
   *
   * Tests use this to start on the screen under test. Walking the rail costs a
   * render pass per keystroke, and at ~29ms each that dwarfed the assertions.
   */
  initialScreen?: ScreenId;
  /** Parsed CLI destination, including filters and an optional detail. */
  initialLocation?: SentryUrlLocation;
  /** Remembered project selections, keyed by organization slug. */
  initialProjectsByOrg?: Readonly<Record<string, readonly string[]>>;
  /** Signed-in account metadata for ownership and employee-gated Seer controls. */
  user?: CurrentUser;
  initialSeerCodeModeByOrg?: Readonly<Record<string, SeerCodeMode>>;
  initialSeerBashModeByOrg?: Readonly<Record<string, boolean>>;
  initialSeerShowThinkingByOrg?: Readonly<Record<string, boolean>>;
  /**
   * Apply a downloaded payload in-process, or restart for a host update.
   * Absent — as in most tests — means the update pill never appears.
   */
  onApplyUpdate?: (update: ReadyUpdate) => boolean | Promise<boolean>;
  /** Ask the runtime host to open a trusted canonical sentry.io URL. */
  onOpenUrl?: (url: string) => boolean | Promise<boolean>;
}

/** Issues › Feed — where the app opens when nothing says otherwise. */
const DEFAULT_SCREEN: ScreenId = "issues.feed";

export function App({
  onQuit,
  client = null,
  org: initialOrg = "",
  initialScreen = DEFAULT_SCREEN,
  initialLocation,
  initialProjectsByOrg = {},
  user,
  initialSeerCodeModeByOrg = {},
  initialSeerBashModeByOrg = {},
  initialSeerShowThinkingByOrg = {},
  onApplyUpdate,
  onOpenUrl,
}: AppProps) {
  const theme = useTheme();
  const { width, height } = useTerminalDimensions();

  const [projectsByOrg, setProjectsByOrg] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      Object.entries(initialProjectsByOrg).map(([slug, projects]) => [slug, [...projects]]),
    ),
  );
  const projectsByOrgRef = useRef(projectsByOrg);
  const [seerCodeModeByOrg, setSeerCodeModeByOrg] = useState<Record<string, SeerCodeMode>>(() => ({
    ...initialSeerCodeModeByOrg,
  }));
  const [seerBashModeByOrg, setSeerBashModeByOrg] = useState<Record<string, boolean>>(() => ({
    ...initialSeerBashModeByOrg,
  }));
  const [seerShowThinkingByOrg, setSeerShowThinkingByOrg] = useState<Record<string, boolean>>(
    () => ({ ...initialSeerShowThinkingByOrg }),
  );

  // The open organization. Sourced from the CLI at startup, then owned here so
  // the picker can repoint every screen at once — every fetch in the tree takes
  // it as a dependency.
  const [org, setOrg] = useState(initialLocation?.org ?? initialOrg);

  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOpenUrl, setShowOpenUrl] = useState(false);
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [webUrlFallback, setWebUrlFallback] = useState<string>();
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [orgFeatures, setOrgFeatures] = useState<readonly string[] | undefined>();
  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>(user);
  const seerAvailable = orgFeatures === undefined || orgFeatures.includes("seer-explorer");
  const availableNavGroups = useMemo(
    () => NAV_GROUPS.filter((group) => group.id !== "seer" || seerAvailable),
    [seerAvailable],
  );

  // One counter drives every fetch on screen: bumping it re-runs the data
  // hooks' effects, so refresh stays a single command rather than one
  // per-screen callback wired back up the tree.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);
  const [canOpen, setCanOpen] = useState(false);

  const focus = useFocusRing(APP_REGIONS, "content");
  const navigation = useNavigation({
    client,
    org,
    reloadToken,
    width,
    initialScreen,
    initialLocation,
    initialSelectedProjects: projectsByOrg[org] ?? [],
    availableNavGroups,
    focus,
    canOpen,
  });
  const {
    activeGroup,
    activeItem,
    backTarget,
    breadcrumb,
    clearViews,
    contentWidth,
    detailView,
    expandNav,
    gotoHotkeys,
    gotoMode,
    listActive,
    navigateTo,
    navigateToScreen,
    navExpanded,
    navExtras,
    openNavGroup,
    pushView,
    railGroup,
    replaceIssue,
    resetOrgScoped,
    screen,
    ScreenComponent,
    secondaryItem,
    seed,
    selectNavItem,
    showSecondaryPane,
    state,
    statusHints,
    topView,
    updateView,
  } = navigation;

  // Fetch org details (including avatar) for whichever org is open.
  useEffect(() => {
    // Drop the previous org's avatar immediately — the wrong face in the rail
    // is worse than none while the new one loads.
    setAvatarUrl(undefined);
    setOrgFeatures(undefined);
    if (!client || !org) return;
    const controller = new AbortController();
    getOrganization(client, { org, signal: controller.signal })
      .then((orgData) => {
        if (orgData.avatar?.avatarUrl) setAvatarUrl(orgData.avatar.avatarUrl);
        // An explicit empty list is meaningful: none of the API-exposed
        // features are enabled. `undefined` above means only "still loading".
        if (Array.isArray(orgData.features)) setOrgFeatures(orgData.features);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [client, org]);

  // Environment and manually supplied tokens have no account metadata in the
  // credentials file. Resolve it once so Code Mode employee gates and run
  // ownership do not silently depend on how the same user authenticated.
  useEffect(() => {
    if (user?.email || !client) {
      setCurrentUser(user);
      return;
    }
    if (activeGroup !== "seer") return;
    const controller = new AbortController();
    getCurrentUser(client, controller.signal)
      .then(setCurrentUser)
      .catch(() => {});
    return () => controller.abort();
  }, [activeGroup, client, user]);

  const setSeerCodeMode = useCallback(
    (mode: SeerCodeMode) => {
      setSeerCodeModeByOrg((current) => {
        const next = { ...current, [org]: mode };
        void writeConfig({ seerCodeModeByOrg: next }).catch(() => {});
        return next;
      });
    },
    [org],
  );

  const setSeerBashMode = useCallback(
    (enabled: boolean) => {
      setSeerBashModeByOrg((current) => {
        const next = { ...current, [org]: enabled };
        void writeConfig({ seerBashModeByOrg: next }).catch(() => {});
        return next;
      });
    },
    [org],
  );

  const setSeerShowThinking = useCallback(
    (enabled: boolean) => {
      setSeerShowThinkingByOrg((current) => {
        const next = { ...current, [org]: enabled };
        void writeConfig({ seerShowThinkingByOrg: next }).catch(() => {});
        return next;
      });
    },
    [org],
  );

  /** Apply a dropdown selection and remember it as this organization's default. */
  const selectProjects = useCallback(
    (projects: string[]) => {
      state.dispatch({ type: "setSelectedProjects", payload: projects });

      const next = { ...projectsByOrgRef.current, [org]: [...projects] };
      projectsByOrgRef.current = next;
      setProjectsByOrg(next);
      void writeConfig({ projectsByOrg: next }).catch(() => {
        // A read-only config dir should not undo the selection on screen.
      });
    },
    [org, state.dispatch],
  );

  useNavigationTrace(activeGroup, activeItem, state.status.loading);

  // Seer's conversation outlives its screen: navigating to Issues and back is
  // not a reason to lose the transcript. The hook is inert until the first
  // message, so it costs nothing while the user is anywhere else.
  const seerChat = useSeerChat(client, org, {
    features: orgFeatures,
    isEmployee: currentUser?.email?.toLowerCase().endsWith("@sentry.io") === true,
    userId: currentUser?.id,
    pageName: screen?.id,
    codeMode: seerCodeModeByOrg[org] ?? "only",
    bashMode: seerBashModeByOrg[org] ?? false,
    showThinking: seerShowThinkingByOrg[org] ?? false,
    onCodeModeChange: setSeerCodeMode,
    onBashModeChange: setSeerBashMode,
    onShowThinkingChange: setSeerShowThinking,
  });

  const currentSentryLocation = useMemo<SentryUrlLocation | undefined>(() => {
    const route = topView?.sentryLocation ?? (screen ? { screen: screen.id } : undefined);
    if (!route) return undefined;

    const carriesScreenState = (!topView && screen?.kind !== "chat") || Boolean(topView?.stateKey);
    const routeState = carriesScreenState
      ? {
          ...route.state,
          query: state.committedQuery,
          sort: state.sort,
          statsPeriod: state.statsPeriod,
          selectedProjects: [...state.selectedProjects],
          selectedEnvs: [...state.selectedEnvs],
        }
      : route.state;

    return {
      org,
      ...route,
      state: routeState,
      ...(route.screen === "seer.ask" && seerChat.runId !== null
        ? { seerRunId: seerChat.runId }
        : {}),
    };
  }, [org, screen, seerChat.runId, state, topView]);

  /** Continue from the current TUI location in production Sentry. */
  const openInBrowser = useCallback(() => {
    if (!currentSentryLocation) return;
    const url = buildSentryUrl(currentSentryLocation);
    if (!onOpenUrl) {
      setWebUrlFallback(url);
      return;
    }
    void Promise.resolve(onOpenUrl(url))
      .then((opened) => {
        if (!opened) setWebUrlFallback(url);
      })
      .catch(() => setWebUrlFallback(url));
  }, [currentSentryLocation, onOpenUrl]);

  // What Enter means on the screen that is mounted, registered by the screen
  // itself. Held in a ref because the key router reads it during a keystroke,
  // not during a render.
  const screenActions = useRef<ScreenActions | null>(null);
  /**
   * Whether the mounted screen has told us what Enter does.
   *
   * The ref above is what the *router* reads, during a keystroke rather than
   * during a render. The status bar is drawn from state, so it needs this
   * mirror: without it the bar printed `(enter) open` for every screen, having
   * never checked that anything was listening — which was a lie on the stub
   * screens and on any list that had not registered an action yet.
   *
   * `useScreenActions` re-registers on every render and clears on unmount, so
   * this flips within a commit rather than across renders, and React collapses
   * the pair into no re-render when the answer has not changed.
   */
  const registerActions = useCallback((actions: ScreenActions | null) => {
    screenActions.current = actions;
    setCanOpen(Boolean(actions?.open || actions?.openDetail));
  }, []);

  const [transientNotice, setTransientNotice] = useState<Notice | null>(null);

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
      clearViews();
      resetOrgScoped(projectsByOrgRef.current[slug] ?? []);
      showNotice({ kind: "info", text: `switched to ${slug}` });

      // Retag, so an error after this points at the org actually on screen.
      identify({ org: slug });
      leaveCrumb({ category: "navigation", message: `switched org to ${slug}` });
      log("info", "ui.org.switched", { org: slug });

      void writeConfig({ org: slug }).catch(() => {
        // A read-only config dir shouldn't undo a switch that already happened;
        // it only means the next launch opens the previous org.
      });
    },
    [clearViews, org, resetOrgScoped, showNotice],
  );

  const triage = useTriage(client, org, {
    onOptimistic: replaceIssue,
    onNotice: showNotice,
  });

  // The row the keyboard acts on: the open issue, else the list cursor. The
  // list survives navigating away, so the cursor only counts while an issue
  // screen is the thing on screen — otherwise `r` on the log view would
  // resolve an issue nobody can see.
  const activeIssue =
    topView?.issue ?? (activeGroup === "issues" ? rowsOf<Group>(state)[state.selected] : undefined);

  // Feature revocation is authoritative even if Seer was open from a deep
  // link or while organization details were still loading.
  useEffect(() => {
    if (activeGroup === "seer" && !seerAvailable) navigateToScreen(DEFAULT_SCREEN);
  }, [activeGroup, navigateToScreen, seerAvailable]);

  /** Apply a parsed URL through the same navigation and view-stack paths as the UI. */
  const openSentryLocation = useCallback(
    (location: SentryUrlLocation) => {
      const target = getScreen(location.screen);
      if (location.org !== org) switchOrg(location.org);
      navigateTo(target.group, target.item);

      const view = viewForSentryUrl(location.detail, location.state);
      if (view) {
        // Stateless details leave their filters on the list underneath them;
        // stateful ones carry the seed on the view itself.
        if (!view.stateKey && location.state) seed(stateKeyOf(target), location.state);
        pushView(view);
      } else if (location.state) {
        seed(stateKeyOf(target), location.state);
      }
    },
    [navigateTo, org, pushView, seed, switchOrg],
  );

  /** Parse one dialog submission, keeping expected failures inside the dialog. */
  const submitSentryUrl = useCallback(
    (url: string): SentryUrlFailure | undefined => {
      const result = parseSentryUrl(url);
      if (result.kind !== "location") {
        recordSentryUrlFailure(result, "command_palette");
        return result;
      }
      openSentryLocation(result.location);
      setShowOpenUrl(false);
      return undefined;
    },
    [openSentryLocation],
  );

  // A newer build sitting in the cache, if there is one. Undefined the whole
  // time for anyone the launcher did not start — see `canSelfUpdate`.
  const pendingUpdate = useUpdateCheck();
  const updateReady = Boolean(pendingUpdate && onApplyUpdate);

  /**
   * Apply the downloaded release, or say why there is nothing to do.
   */
  const runUpdate = useCallback(() => {
    if (!pendingUpdate || !onApplyUpdate) {
      // Short on purpose: the hints row owns the other end of the bar, and at
      // 100 cells anything longer than this is clipped mid-word.
      showNotice({ kind: "idle", text: "already up to date" });
      return;
    }
    void Promise.resolve(onApplyUpdate(pendingUpdate)).then((applied) => {
      if (!applied) showNotice({ kind: "error", text: "update could not be applied" });
    });
  }, [pendingUpdate, onApplyUpdate, showNotice]);

  const paletteActions = useMemo(
    () =>
      buildPaletteActions(
        {
          streamView: listActive,
          hasIssue: Boolean(activeIssue),
          updateReady,
        },
        availableNavGroups,
      ),
    [listActive, activeIssue, updateReady, availableNavGroups],
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
        case "sentry.app.openUrl":
          setShowOpenUrl(true);
          return;
        case "sentry.app.openInBrowser":
          openInBrowser();
          return;
        case "sentry.app.update":
          runUpdate();
          return;
        case "sentry.nav.search":
          focus.focus("content");
          state.focusSearch();
          return;
        // Only a screen with a filter row can close what these open, so on one
        // without, they do nothing at all. See `isFilterBarMounted`.
        case "sentry.view.filterProject":
        case "sentry.view.filterEnv":
        case "sentry.view.filterDate": {
          if (!isFilterBarMounted(FILTER_COMMAND_DROPDOWN[commandId])) return;
          focus.focus("content");
          state.dispatch({
            type: "setOpenDropdown",
            payload: FILTER_COMMAND_DROPDOWN[commandId],
          });
          return;
        }
        default:
          // The remaining palette-scoped commands are all triage actions; the
          // catalog only offers them when there is an issue to act on.
          if (findTriageAction(commandId) && activeIssue) triage.run(commandId, activeIssue);
      }
    },
    [activeIssue, focus, navigateTo, onQuit, openInBrowser, refresh, runUpdate, state, triage],
  );

  /**
   * Mouse handling for a row: the first click puts the cursor on the row, a
   * second click on that same row opens it. Two steps rather than one, because
   * a stray click in a list is cheap to recover from only while it moves a
   * cursor — and it mirrors the rail, where a click picks a group and a click
   * in the list beside it commits.
   */
  const activateRow = useCallback(
    (index: number) => {
      // A click that arrives while the list is unfocused is the one that
      // focuses it, so it can only ever select — the cursor it would be
      // "confirming" wasn't on screen to be aimed at.
      const confirming = focus.focusedRef.current === "content" && index === state.selected;
      state.dispatch({ type: "setSelected", payload: index });
      // The secondary nav is a drawer over the nav rail; acting in the content
      // pane closes it, exactly as choosing an item from it does.
      navigation.dispatch({ type: "closeSecondary" });
      focus.focus("content");
      if (confirming) screenActions.current?.open?.(index);
    },
    [focus, navigation, state],
  );

  const keyHandlers = createAppKeyHandlers({
    showOpenUrl: showOpenUrl || Boolean(webUrlFallback),
    showPalette,
    showHelp,
    showOrgPicker,
    setShowOpenUrl,
    setShowPalette,
    setShowHelp,
    setShowOrgPicker,
    navigation,
    state,
    screenActions,
    focus,
    availableNavGroups,
    activeIssue,
    triage: triage.run,
    refresh,
    runUpdate,
    openInBrowser,
    onQuit,
  });

  useKeyboard((key) => {
    routeKeyOwnership(keyHandlers, key, consumeKey);
  });

  const contentHeight = Math.max(3, height - 3);
  const contentFocused = focus.isFocused("content") && !showOrgPicker;

  /**
   * What the content pane hands whatever it draws. A screen and a pushed view
   * take the same things — the view just brings its own renderer.
   */
  const paneProps = {
    client,
    org,
    focused: contentFocused,
    width: contentWidth,
    height: contentHeight,
    reloadToken,
    onProjectSelect: selectProjects,
    pendingIds: triage.pending,
    pushView,
    notify: showNotice,
    activateRow,
    registerActions,
    updateView,
    navigateToScreen,
  };

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
          expanded={navExpanded}
          focused={focus.isFocused("nav")}
          avatarUrl={avatarUrl}
          orgSlug={org}
          groups={availableNavGroups}
          hotkeys={gotoHotkeys?.groups}
          onSelect={openNavGroup}
          onExpand={expandNav}
          onOrgPress={() => setShowOrgPicker(true)}
        />
        {showSecondaryPane ? (
          <SecondaryNav
            group={railGroup}
            activeItem={secondaryItem}
            focused={focus.isFocused("secondary")}
            extras={navExtras}
            hotkeys={gotoHotkeys?.items}
            onSelect={selectNavItem}
          />
        ) : null}
        <box
          title={breadcrumb}
          titleColor={theme.accent}
          style={{
            flexGrow: 1,
            flexDirection: "column",
            // Clip rather than letting an over-tall screen paint over the
            // pane's bottom border and the status bar below it.
            overflow: "hidden",
            border: true,
            borderColor:
              contentFocused && !state.searchFocused ? theme.borderFocused : theme.border,
          }}
        >
          {/* Seer reads its transcript from here; every other screen ignores it. */}
          <SeerChatContext.Provider value={seerChat}>
            {topView ? (
              topView.render({
                ...paneProps,
                // A view with no slice of its own gets none: it is a detail
                // pane, and `state` would be the list's underneath it.
                state: topView.stateKey ? state : undefined,
                issue: topView.issue,
              })
            ) : ScreenComponent && screen ? (
              // Sibling screens can use the same component in this slot. Key
              // by route so React does not carry that component's hook-local
              // rows and charts into a different screen while it loads.
              <ScreenComponent key={screen.id} {...paneProps} screen={screen} state={state} />
            ) : (
              <box style={{ flexDirection: "column", paddingLeft: 1 }}>
                <text fg={theme.text} attributes={1}>
                  {`${getNavGroup(activeGroup).label} › ${activeItem}`}
                </text>
                <text fg={theme.muted}>Not implemented yet.</text>
              </box>
            )}
          </SeerChatContext.Provider>
        </box>
        {/*
          Drawn over the pane's top border, opposite the trail in its title.
          A sibling of the pane rather than a child: the pane clips its
          overflow, and this deliberately lands on the frame itself.
        */}
        {topView ? (
          <DetailBackRow parent={backTarget} top={0} right={width - 1} paneWidth={contentWidth} />
        ) : null}
      </box>

      <StatusBar
        notice={
          // Goto mode is a held-open key prompt, so it outranks even a fresh
          // triage result: the bar has to answer "what is it waiting for?".
          gotoMode
            ? { kind: "info", text: "go to…" }
            : // A triage result or an org switch is the most recent thing the
              // user did, so it outranks the ambient load notice.
              (transientNotice ??
              (detailView
                ? { kind: "idle", text: detailView.label ?? "" }
                : toNotice(state.status)))
        }
        since={detailView || gotoMode ? undefined : state.status.since}
        hints={statusHints}
        onUpdate={updateReady ? runUpdate : undefined}
      />

      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}

      {showPalette ? (
        <CommandPalette
          actions={paletteActions}
          onRun={runPaletteAction}
          onClose={() => setShowPalette(false)}
        />
      ) : null}

      {showOpenUrl ? (
        <OpenSentryUrlDialog onSubmit={submitSentryUrl} onClose={() => setShowOpenUrl(false)} />
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

      {webUrlFallback ? (
        <WebUrlDialog url={webUrlFallback} onClose={() => setWebUrlFallback(undefined)} />
      ) : null}
    </box>
  );
}

/** The ambient notice: what the screen on screen is doing, in its own words. */
function toNotice(status: ScreenStatus): Notice {
  if (status.error) return { kind: "error", text: status.error };
  if (status.loading) {
    return { kind: "loading", text: status.noun ? `loading ${status.noun}…` : "loading…" };
  }
  return { kind: "idle", text: "" };
}
