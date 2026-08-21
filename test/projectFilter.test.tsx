/**
 * Issues › the project selector — slug-only rows and its filter box.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { groupsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

const PROJECTS = [
  { id: "1", slug: "backend", name: "Backend Services", platform: "python" },
  { id: "2", slug: "frontend", name: "Frontend Web", platform: "javascript" },
  { id: "3", slug: "mobile-ios", name: "iOS App", platform: "apple-ios" },
];

/** Records the project filters each issue-list request carried. */
function stubClient() {
  const issueUrls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("issues-stats")) {
      payload = {};
    } else if (url.includes("/projects/")) {
      payload = PROJECTS;
    } else if (url.includes("/environments/")) {
      payload = [];
    } else if (url.includes("/issues/?")) {
      issueUrls.push(url);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { issueUrls, client: new SentryClient({ auth, fetchImpl }) };
}

const renderApp = (client: SentryClient) =>
  renderHarness(<App onQuit={() => {}} client={client} org="acme" />, {
    width: WIDTH,
    height: HEIGHT,
  });

const PROJECT_BOX = "┌─ Project ";

/**
 * The dropdown's own rows, cut out of the frame by its box borders.
 *
 * A dropdown overlays the stream, so every line it sits on also holds issue
 * text — "backend" is a project slug *and* a culprit in the list behind it.
 * Slicing the box's columns is the only way to assert on what the picker
 * itself is showing.
 */
function pickerRows(frame: string, title: string): string[] {
  const lines = frame.split("\n");
  const top = lines.findIndex((line) => line.includes(`┌─ ${title} `));
  if (top < 0) return [];
  const left = lines[top]!.indexOf(`┌─ ${title} `);
  const width = lines[top]!.slice(left).indexOf("┐") + 1;

  const rows: string[] = [];
  for (const line of lines.slice(top + 1)) {
    const slice = line.slice(left, left + width);
    if (slice.startsWith("└")) break;
    rows.push(slice.slice(1, -1).trimEnd());
  }
  return rows;
}

/** Open the stream, then the project dropdown on it. */
async function openProjectDropdown(h: Harness) {
  await h.waitForFrame((f) => f.includes("TypeError"));
  await h.press((i) => i.pressKey("P"));
  await h.waitForFrame((f) => f.includes(PROJECT_BOX));
}

test("the project list is slugs, never display names", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    expect(pickerRows(h.frame(), "Project")).toEqual([
      "(/) filter…",
      "● All",
      "  backend",
      "  frontend",
      "  mobile-ios",
    ]);
  } finally {
    await h.cleanup();
  }
});

test("the filter box waits for the search key before it takes text", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    // Unfocused, "f" types nothing — the whole list is still there.
    await h.press((i) => i.pressKey("f"));
    expect(pickerRows(h.frame(), "Project")).toContain("  backend");

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("front"));
    await h.waitForFrame((f) => !pickerRows(f, "Project").includes("  backend"));

    expect(pickerRows(h.frame(), "Project")).toEqual(["(/) front", "  frontend"]);
  } finally {
    await h.cleanup();
  }
});

test("a fuzzy query still finds the slug, and enter scopes the stream to it", async () => {
  const { client, issueUrls } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    await h.press((i) => i.pressKey("/"));
    // Non-contiguous: "mios" reaches mobile-ios the way the palette matches.
    await h.press((i) => i.pressKey("mios"));
    await h.waitForFrame((f) => !pickerRows(f, "Project").includes("  frontend"));
    expect(pickerRows(h.frame(), "Project")).toEqual(["(/) mios", "  mobile-ios"]);

    issueUrls.length = 0;
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => !f.includes(PROJECT_BOX));

    const url = issueUrls.at(-1);
    expect(url).toBeDefined();
    expect(new URL(url!).searchParams.getAll("project")).toEqual(["mobile-ios"]);
    // The chip names the chosen project once the dropdown is gone.
    expect(h.frame()).toContain("mobile-ios ▾");
  } finally {
    await h.cleanup();
  }
});

test("escape clears the filter first, then closes the dropdown", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("front"));
    await h.waitForFrame((f) => !pickerRows(f, "Project").includes("  backend"));

    await h.pressEscape();
    await h.waitForFrame((f) => pickerRows(f, "Project").includes("  backend"));
    expect(pickerRows(h.frame(), "Project")[0]).toBe("(/) filter…");

    await h.pressEscape();
    await h.waitForFrame((f) => !f.includes(PROJECT_BOX));
    expect(h.frame()).toContain("all projects");
  } finally {
    await h.cleanup();
  }
});
