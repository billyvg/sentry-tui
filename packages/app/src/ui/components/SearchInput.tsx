/**
 * The bordered search box every list screen sits under, prefixed with its
 * underlined `/` hotkey.
 *
 * The box itself is three lines of styling, but the focus wiring is not: a
 * click lands on the native input rather than going through the app's key
 * router, so the renderable's own FOCUSED / BLURRED events have to be pushed
 * back into screen state or the two disagree about who has the keyboard.
 * Getting that wrong once per screen is what this component exists to prevent.
 *
 * Every field it needs is already on the screen's slice, so wiring it is one
 * block whatever the screen is:
 *
 * ```tsx
 * <SearchInput
 *   value={state.searchQuery}
 *   placeholder="Search spans…"
 *   focused={state.searchFocused}
 *   width={width}
 *   onInput={(query) => state.dispatch({ type: "setSearchQuery", payload: query })}
 *   onFocus={state.focusSearch}
 *   onBlur={state.handleSearchBlur}
 * />
 * ```
 *
 * Note `state.searchQuery`, not `state.committedQuery`: the input shows what is
 * being typed, and the fetch uses what Enter last submitted. The app's key
 * router owns `/`, Enter and Escape — a screen registers no keys for this.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { RenderableEvents, type InputRenderable } from "@opentui/core";

import { useTheme } from "~/ui/theme";
import { SEARCH_ROWS } from "~/ui/components/FilterBar";
import { SearchInputHint } from "~/ui/components/SearchInputHint";

let mountedSearchInputs = 0;
const mountListeners = new Set<() => void>();

/** Is a list search box on screen to answer the global search shortcut? */
export function isSearchInputMounted(): boolean {
  return mountedSearchInputs > 0;
}

/** Subscribe status hints to the same availability the key router checks. */
function subscribeToMounts(listener: () => void): () => void {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
}

/** Update rendered shortcut hints when a search box mounts or unmounts. */
export function useSearchInputMounted(): boolean {
  return useSyncExternalStore(subscribeToMounts, isSearchInputMounted);
}

export interface SearchInputProps {
  /** Live value of the input: `state.searchQuery`, not the committed one. */
  value: string;
  placeholder: string;
  focused: boolean;
  width: number;
  onInput: (value: string) => void;
  /** `state.focusSearch` — the input took focus natively. */
  onFocus: () => void;
  /** `state.handleSearchBlur` — the input lost focus natively. */
  onBlur: () => void;
}

export function SearchInput({
  value,
  placeholder,
  focused,
  width,
  onInput,
  onFocus,
  onBlur,
}: SearchInputProps) {
  useEffect(() => {
    mountedSearchInputs += 1;
    for (const listener of mountListeners) listener();
    return () => {
      mountedSearchInputs -= 1;
      for (const listener of mountListeners) listener();
    };
  }, []);

  const theme = useTheme();
  const inputRef = useRef<InputRenderable>(null);

  // Listeners are attached in a ref callback rather than an effect: the
  // renderable is replaced, not mutated, when the tree changes, so the old
  // one's listeners have to come off at the moment the new one arrives.
  const inputRefCallback = useCallback(
    (node: InputRenderable | null) => {
      const previous = inputRef.current;
      if (previous) {
        previous.removeAllListeners(RenderableEvents.FOCUSED);
        previous.removeAllListeners(RenderableEvents.BLURRED);
      }
      inputRef.current = node;
      if (node) {
        node.on(RenderableEvents.FOCUSED, () => onFocus());
        node.on(RenderableEvents.BLURRED, () => onBlur());
      }
    },
    [onFocus, onBlur],
  );

  return (
    <box
      style={{
        flexDirection: "row",
        width,
        flexShrink: 0,
        height: SEARCH_ROWS,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? theme.accent : theme.border,
        backgroundColor: theme.panel,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <SearchInputHint />
      <input
        ref={inputRefCallback}
        value={value}
        placeholder={placeholder}
        focused={focused}
        onInput={onInput}
        style={{
          flexGrow: 1,
          textColor: theme.text,
          backgroundColor: theme.panel,
          focusedTextColor: theme.text,
          focusedBackgroundColor: theme.panel,
          placeholderColor: theme.subText,
        }}
      />
    </box>
  );
}
