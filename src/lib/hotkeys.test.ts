import { describe, expect, test } from "bun:test";

import { assignHotkeys } from "~/lib/hotkeys";

describe("assignHotkeys", () => {
  test("takes each label's initial when it is free", () => {
    expect(assignHotkeys(["Issues", "Explore", "Dashboards"])).toEqual([
      { key: "i", index: 0 },
      { key: "e", index: 0 },
      { key: "d", index: 0 },
    ]);
  });

  test("lower-cases the key even when the label is capitalised", () => {
    expect(assignHotkeys(["Feed"])[0]).toEqual({ key: "f", index: 0 });
  });

  test("falls to a later character when the initial is taken", () => {
    // "Inbox" wants `i`, which "Issues" already holds; `n` is the next free
    // character of its own, so the hint prints as `I(n)box`.
    expect(assignHotkeys(["Issues", "Inbox"])[1]).toEqual({ key: "n", index: 1 });
  });

  test("prefers a later word's initial over the first word's middle", () => {
    // "All Views" gives up `a` and reaches for `v` — the start of a word — in
    // preference to the `l`s buried in "All".
    expect(assignHotkeys(["Archive", "All Views"])[1]).toEqual({ key: "v", index: 4 });
  });

  test("skips characters that can't be typed as a key", () => {
    // The space and the ampersand are not candidates, so the `o` of "Outages"
    // is what's left once `e` and `r` are gone.
    expect(assignHotkeys(["Errors", "Reviewed", "Errors & Outages"])[2]).toEqual({
      key: "o",
      index: 9,
    });
  });

  test("appends an unrelated key when the label has nothing left", () => {
    // Both of "ab"'s characters are gone by the time the third label asks, so
    // it gets a key from outside itself, to be printed beside it.
    const [, , third] = assignHotkeys(["ab", "ba", "ab"]);
    expect(third).toEqual({ key: "c", index: -1 });
  });

  test("honours reserved keys", () => {
    expect(assignHotkeys(["Go"], ["g"])[0]).toEqual({ key: "o", index: 1 });
  });

  test("gives same-named labels their own keys", () => {
    expect(assignHotkeys(["Errors", "Errors"])).toEqual([
      { key: "e", index: 0 },
      { key: "r", index: 1 },
    ]);
  });

  test("returns undefined once every key is spoken for", () => {
    const alphabet = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
    expect(assignHotkeys(["Extra"], alphabet)[0]).toBeUndefined();
  });
});
