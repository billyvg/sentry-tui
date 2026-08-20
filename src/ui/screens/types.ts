/**
 * The contract between `App` and a screen.
 *
 * A screen is a component that takes `ScreenProps` and renders the content
 * pane. It owns its fetch and its layout; the app owns navigation, the key
 * router, the status bar, and the view stack, and hands the screen a way into
 * each of those. Adding one is a new file plus a line in `SCREEN_COMPONENTS`.
 *
 * See `docs/plans/002-screen-contract.md` for the field-by-field reference.
 */

import type { ReactNode } from "react";

import type { SentryClient } from "~/api/client";
import type { Group } from "~/api/types";
import type { ScreenDef } from "~/core/screens";
import type { Notice } from "~/ui/components/StatusBar";
import type { ScreenState, ScreenStateSeed } from "~/ui/hooks/useScreenState";

/**
 * Keyboard actions the app routes to the screen on screen.
 *
 * Cursor movement is handled centrally — the app clamps and moves
 * `state.selected` for every screen. What a screen has to say is what *Enter*
 * means, which is nearly always "push a detail view for this row".
 */
export interface ScreenActions {
  /** Enter, or a second click on the cursor row. */
  open?: (index: number) => void;
  /**
   * Escape, offered to the screen before anything else claims it. Return true
   * if it was used — closing an inline panel, say — and false to let the key
   * carry on to the app.
   */
  back?: () => boolean;
}

/**
 * A screen component.
 *
 * Spelled out rather than `ComponentType<ScreenProps>`: React 19's own
 * component types admit an async component, which is not something this
 * renderer can draw.
 */
export type ScreenComponent = (props: ScreenProps) => ReactNode;

export interface ScreenProps {
  /** Authenticated API client, or null before sign-in. */
  client: SentryClient | null;
  /** The open organization slug. Every fetch must take it as a dependency. */
  org: string;
  /** The registry entry being rendered — its id, kind, and defaults. */
  screen: ScreenDef;
  /** This screen's slice of app state: rows, cursor, filters, search. */
  state: ScreenState;
  /** The content pane holds focus. Paint the cursor only when it does. */
  focused: boolean;
  /** Cells available inside the content pane's border. */
  width: number;
  /** Lines available inside the content pane's border. */
  height: number;
  /** Bump to refetch the current query — the app's global refresh. */
  reloadToken: number;
  /** Row ids with a mutation in flight, for a pending marker. */
  pendingIds: ReadonlySet<string>;
  /** Push a detail view; Escape pops it. */
  pushView: (view: ViewStackEntry) => void;
  /** Say something in the status bar. It clears itself after a few seconds. */
  notify: (notice: Notice) => void;
  /**
   * A row was clicked: move the cursor there, and open it if it was already
   * the cursor row. Wire a table's `onRowClick` straight to this.
   */
  activateRow: (index: number) => void;
  /**
   * Tell the app what Enter does on this screen. Call it through
   * `useScreenActions`, which handles registering and unregistering.
   */
  registerActions: (actions: ScreenActions | null) => void;
}

/**
 * What a pushed view is given when the app draws it: everything a screen gets
 * except the registry entry it doesn't have, plus what the entry carries.
 *
 * A view with no `stateKey` is a static detail pane and can ignore most of
 * this. One *with* a `stateKey` is a screen in all but name — it has rows, a
 * cursor, filters and a search bar, and the app drives them the same way.
 */
export interface DetailContext extends Omit<ScreenProps, "screen" | "state"> {
  /**
   * The entry's issue, if it has one, kept current through optimistic triage
   * updates. Prefer it over the value captured when the view was pushed.
   */
  issue?: Group;
  /** The slice named by the entry's `stateKey`, if it declared one. */
  state?: ScreenState;
}

/**
 * A view on the app's stack: Enter pushes one, Escape pops it.
 *
 * The entry carries its own renderer, so the app never learns what a monitor
 * or a replay detail looks like — pushing one costs nothing in `App.tsx`.
 */
export interface ViewStackEntry {
  /** Unique within the stack; also the React key. */
  id: string;
  /** Status-bar text while this view is on top, e.g. an issue's short id. */
  label?: string;
  /**
   * The issue this view is about, when it is about one. Its presence is what
   * puts the triage keys in scope while the view is open.
   */
  issue?: Group;
  /**
   * Give the view a state slice of its own and it stops being a static detail
   * pane: the app drives its cursor, its search bar, and its filters exactly
   * as it does a screen's, and hands the slice back through `ctx.state`. A
   * saved search's results are a view like this; an issue's detail is not.
   */
  stateKey?: string;
  /** Filters the slice starts from. Applied when the view is pushed. */
  initialState?: ScreenStateSeed;
  render: (ctx: DetailContext) => ReactNode;
}
