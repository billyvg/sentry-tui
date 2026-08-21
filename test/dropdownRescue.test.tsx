/**
 * The filter keys are global, but a filter row is not.
 *
 * `P`, `E` and `D` are in the command table for every screen, while only a
 * screen with a `FilterBar` mounts a `Dropdown` to answer them. On a screen
 * with no filter row the open-dropdown state could be set with nothing on
 * screen to clear it — and because the router hands every key to the "focused"
 * widget while a dropdown is open, the app stopped responding to the keyboard
 * entirely until it was killed. Escape now rescues an orphaned dropdown, while
 * a real one keeps its own two-stage Escape.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupsFixture, savedViewsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/** Index of "All Views" in the flattened Issues nav item list. */
const ALL_VIEWS_INDEX = 8;

function stubClient() {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("group-search-views")) {
      const createdBy = new URL(url).searchParams.get("createdBy");
      payload = createdBy === "me" ? savedViewsFixture.mine : savedViewsFixture.others;
    } else if (url.includes("issues-stats")) {
      payload = {};
    } else if (url.includes("/projects/")) {
      payload = [{ id: "42", slug: "backend", name: "Backend", platform: "python" }];
    } else if (url.includes("/environments/")) {
      payload = [];
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new SentryClient({ auth, fetchImpl });
}

/** All Views is a real screen with no filter row — the shape that wedged. */
async function openAllViews(h: Harness) {
  await h.press((i) => i.pressTab());
  await h.press((i) => i.pressEnter());
  for (let n = 0; n < ALL_VIEWS_INDEX; n++) await h.press((i) => i.pressKey("j"));
  await h.press((i) => i.pressEnter());
}

test("a filter key on a screen with no filter row does not wedge the keyboard", async () => {
  const h = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await openAllViews(h);
    expect(h.frame()).toContain("All Views");

    // Opens a dropdown that nothing is mounted to draw or close.
    await h.press((i) => i.pressKey("P"));
    await h.pressEscape();

    // The keyboard still answers: without the rescue, this help dialog never
    // opened and every subsequent key was swallowed too.
    await h.press((i) => i.pressKey("?"));
    expect(h.frame()).toContain("Keyboard");
  } finally {
    await h.cleanup();
  }
});

test("the other two filter keys rescue the same way", async () => {
  const h = await renderHarness(<App onQuit={() => {}} client={stubClient()} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });
  try {
    await openAllViews(h);

    for (const key of ["E", "D"]) {
      await h.press((i) => i.pressKey(key));
      await h.pressEscape();
    }

    await h.press((i) => i.pressKey("?"));
    expect(h.frame()).toContain("Keyboard");
  } finally {
    await h.cleanup();
  }
});
