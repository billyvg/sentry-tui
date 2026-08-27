import { describe, expect, mock, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";

import type { NavigationState } from "~/ui/hooks/useNavigation";
import type { ScreenState } from "~/ui/hooks/useScreenState";
import {
  createGotoHandler,
  createListCursorHandler,
  createOverlayHandler,
  createScreenKeyHandler,
  createScreenInputHandler,
  createViewStackHandler,
} from "~/ui/lib/appKeyHandlers";
import type { ScreenActions } from "~/ui/screens/types";

/** Construct the key fields command matching reads in unit tests. */
function key(name: string, modifiers: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, meta: false, ...modifiers } as KeyEvent;
}

/** Cast only the navigation fields a handler under test reads. */
function navigation(fields: Partial<NavigationState>): NavigationState {
  return fields as NavigationState;
}

describe("app key handler factories", () => {
  test("an open overlay ends routing at its correct owner", () => {
    const closeHelp = mock(() => {});
    const palette = createOverlayHandler({
      showOpenUrl: false,
      showPalette: true,
      showHelp: false,
      setShowHelp: closeHelp,
    });
    expect(palette(key("j"))).toBe("focused");

    const help = createOverlayHandler({
      showOpenUrl: false,
      showPalette: false,
      showHelp: true,
      setShowHelp: closeHelp,
    });
    expect(help(key("escape"))).toBe("mine");
    expect(closeHelp).toHaveBeenCalledWith(false);
  });

  test("a screen input owns text and can submit Enter", () => {
    const submitInput = mock(() => true);
    const actions: { current: ScreenActions | null } = {
      current: { inputFocused: () => true, submitInput },
    };
    const handler = createScreenInputHandler({ screenActions: actions });

    expect(handler(key("x"))).toBe("focused");
    expect(handler(key("return"))).toBe("mine");
    expect(submitInput).toHaveBeenCalledTimes(1);
  });

  test("goto mode opens through its dedicated stage", () => {
    const dispatch = mock(() => {});
    const handler = createGotoHandler({
      navigation: navigation({ gotoMode: false, dispatch }),
      setShowOrgPicker: () => {},
    });

    expect(handler(key("n"))).toBe("mine");
    expect(dispatch).toHaveBeenCalledWith({ type: "openGoto" });
  });

  test("a secondary drawer closes before the underlying view pops", () => {
    const popView = mock(() => {});
    const withDrawer = createViewStackHandler({
      navigation: navigation({ topView: {} as never, showSecondary: true, popView }),
    });
    expect(withDrawer(key("escape"))).toBe("notMine");
    expect(popView).not.toHaveBeenCalled();

    const withoutDrawer = createViewStackHandler({
      navigation: navigation({ topView: {} as never, showSecondary: false, popView }),
    });
    expect(withoutDrawer(key("escape"))).toBe("mine");
    expect(popView).toHaveBeenCalledTimes(1);
  });

  test("the list cursor stage applies movement through ScreenState", () => {
    let selected = 1;
    const dispatch: ScreenState["dispatch"] = mock((action) => {
      if (action.type !== "setSelected") return;
      selected = typeof action.payload === "function" ? action.payload(selected) : action.payload;
    });
    const handler = createListCursorHandler({
      navigation: navigation({ listActive: true }),
      state: { entries: [{}, {}, {}], selected, dispatch } as unknown as ScreenState,
      screenActions: { current: null },
      focus: {
        focusedRef: { current: "content" },
        isFocused: (region) => region === "content",
        focus: () => {},
      },
    });

    expect(handler(key("j"))).toBe("mine");
    expect(selected).toBe(2);
  });

  test("a static detail can own Enter without pretending to be a list", () => {
    const openDetail = mock(() => {});
    const handler = createScreenKeyHandler({
      screenActions: { current: { openDetail } },
      focus: {
        focusedRef: { current: "content" },
        isFocused: (region) => region === "content",
        focus: () => {},
      },
    });

    expect(handler(key("return"))).toBe("mine");
    expect(openDetail).toHaveBeenCalledTimes(1);
  });
});
