/**
 * Issues › the project selector — slug-only rows, and a filter box that
 * searches the org rather than only the page it was given.
 */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { App } from "~/ui/App";
import { SEARCH_DEBOUNCE_MS } from "~/ui/hooks/useProjects";
import { groupsFixture } from "./fixtures";
import { renderHarness, type Harness } from "./helpers";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const WIDTH = 120;
const HEIGHT = 30;

/**
 * More projects than one page holds, so the ones at the end are reachable
 * only by asking the server for them — which is the case this file is about.
 * `zeta-payments` is found by its slug, `checkout` only by its name.
 */
const PROJECTS = [
  { id: "1", slug: "backend", name: "Backend Services", platform: "python" },
  { id: "2", slug: "frontend", name: "Frontend Web", platform: "javascript" },
  { id: "3", slug: "mobile-ios", name: "iOS App", platform: "apple-ios" },
  ...Array.from({ length: 120 }, (_, i) => ({
    id: String(100 + i),
    slug: `service-${i}`,
    name: `Service ${i}`,
    platform: "python",
  })),
  { id: "900", slug: "zeta-payments", name: "Zeta Payments", platform: "go" },
  { id: "901", slug: "checkout", name: "Buy Flow", platform: "ruby" },
];

/** Long enough for the box to stop typing, ask, and be answered. */
const SEARCH_SETTLE_MS = SEARCH_DEBOUNCE_MS + 60;

/**
 * Records the project filters each issue-list request carried, and answers the
 * project list the way the API does: `query` matches a substring of the slug
 * or the name, and `per_page` cuts the result off.
 */
function stubClient() {
  const issueUrls: string[] = [];
  const projectUrls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let payload: unknown = groupsFixture;
    if (url.includes("issues-stats")) {
      payload = {};
    } else if (url.includes("/projects/")) {
      projectUrls.push(url);
      const params = new URL(url).searchParams;
      const query = (params.get("query") ?? "").toLowerCase();
      const perPage = Number(params.get("per_page") ?? 50);
      payload = PROJECTS.filter(
        (project) =>
          project.slug.toLowerCase().includes(query) || project.name.toLowerCase().includes(query),
      ).slice(0, perPage);
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
  return { issueUrls, projectUrls, client: new SentryClient({ auth, fetchImpl }) };
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

/** Type into the filter box and wait for the search it sends to come back. */
async function search(h: Harness, text: string) {
  await h.press((i) => i.pressKey("/"));
  await h.press((i) => i.pressKey(text));
  await h.wait(SEARCH_SETTLE_MS);
}

test("the project list is slugs, never display names", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    expect(pickerRows(h.frame(), "Project").slice(0, 5)).toEqual([
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

    await search(h, "front");

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

    // Non-contiguous: "mios" reaches mobile-ios the way the palette matches —
    // and the way the server, which only knows substrings, cannot.
    await search(h, "mios");
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

test("a project past the first page is searched for, listed, and selectable", async () => {
  const { client, issueUrls, projectUrls } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);
    // It is nowhere in the page the picker opened on.
    expect(pickerRows(h.frame(), "Project")).not.toContain("  zeta-payments");

    await h.press((i) => i.pressKey("/"));
    await h.press((i) => i.pressKey("zeta"));
    // Nothing held matches it and the search has yet to go out, let alone come
    // back — which is not the same as a miss, and doesn't read as one.
    expect(pickerRows(h.frame(), "Project")).toEqual(["(/) zeta", " Searching…"]);

    await h.wait(SEARCH_SETTLE_MS);

    expect(projectUrls.some((url) => new URL(url).searchParams.get("query") === "zeta")).toBe(true);
    expect(pickerRows(h.frame(), "Project")).toEqual(["(/) zeta", "  zeta-payments"]);

    issueUrls.length = 0;
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => !f.includes(PROJECT_BOX));

    expect(new URL(issueUrls.at(-1)!).searchParams.getAll("project")).toEqual(["zeta-payments"]);
    expect(h.frame()).toContain("zeta-payments ▾");
  } finally {
    await h.cleanup();
  }
});

test("a project the server matched on its name is listed, slug and all", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);

    // "buy" is in the display name, which no row shows and no local match can
    // see — only the server's answer puts it in the list.
    await search(h, "buy");

    expect(pickerRows(h.frame(), "Project")).toEqual(["(/) buy", "  checkout"]);
  } finally {
    await h.cleanup();
  }
});

test("the chosen project keeps its row when the list it came from is gone", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);
    await search(h, "zeta");
    await h.press((i) => i.pressEnter());
    await h.waitForFrame((f) => !f.includes(PROJECT_BOX));

    // Reopened, the picker is back on the first page — which zeta-payments is
    // not on. It leads the list anyway, marked as the selection.
    await h.press((i) => i.pressKey("P"));
    await h.waitForFrame((f) => f.includes(PROJECT_BOX));
    expect(pickerRows(h.frame(), "Project").slice(0, 3)).toEqual([
      "(/) filter…",
      "  All",
      "● zeta-payments",
    ]);
  } finally {
    await h.cleanup();
  }
});

test("escape clears the filter first, then closes the dropdown", async () => {
  const { client } = stubClient();
  const h = await renderApp(client);
  try {
    await openProjectDropdown(h);
    await search(h, "front");
    expect(pickerRows(h.frame(), "Project")).not.toContain("  backend");

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
