/** Targeted project-reference loading for ID-to-slug consumers. */

import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import { listProjectReferences } from "~/api/issues";
import type { Project } from "~/api/types";
import { App } from "~/ui/App";
import { useProjectSlugs } from "~/ui/hooks/useProjects";
import { renderHarness } from "./helpers";
import { workflowDetectorsFixture, workflowsFixture } from "./workflow-fixtures";

const auth = createTokenAuthProvider({ token: "sntryu_test" });
const PROJECTS: Project[] = [
  { id: "42", slug: "backend", name: "Backend", platform: "python" },
  { id: "43", slug: "frontend", name: "Frontend", platform: "javascript" },
];

interface ProjectRequest {
  ids: string[];
  perPage: string | null;
  collapse: string[];
  cursor: string | null;
  statsPeriod: string | null;
}

interface ProjectClient {
  client: SentryClient;
  requests: ProjectRequest[];
}

/** A project-summary endpoint that honors `id:` search tokens. */
function projectClient({
  workflows = false,
  failProjects = 0,
}: { workflows?: boolean; failProjects?: number } = {}): ProjectClient {
  const requests: ProjectRequest[] = [];
  let failuresLeft = failProjects;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.pathname.endsWith("/projects/")) {
      const query = url.searchParams.get("query") ?? "";
      const ids = [...query.matchAll(/(?:^|\s)id:(\d+)/g)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      );
      requests.push({
        ids,
        perPage: url.searchParams.get("per_page"),
        collapse: url.searchParams.getAll("collapse"),
        cursor: url.searchParams.get("cursor"),
        statsPeriod: url.searchParams.get("statsPeriod"),
      });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return json({ detail: "nope" }, 500);
      }
      const wanted = new Set(ids);
      return json(
        PROJECTS.filter((project) => wanted.has(project.id)).map((project) => ({
          ...project,
          latestDeploys: { production: { version: "ignored" } },
          features: ["ignored"],
        })),
      );
    }
    if (workflows && url.pathname.endsWith("/workflows/")) return json(workflowsFixture);
    if (workflows && url.pathname.endsWith("/detectors/")) {
      const wanted = new Set(url.searchParams.getAll("id"));
      return json(workflowDetectorsFixture.filter((detector) => wanted.has(detector.id)));
    }
    return json([]);
  }) as unknown as typeof fetch;

  return {
    client: new SentryClient({ auth, fetchImpl, maxRetries: 0 }),
    requests,
  };
}

/** Render the slugs resolved for one set of project ids. */
function ProjectProbe({
  client,
  label,
  ids,
}: {
  client: SentryClient;
  label: string;
  ids: string[];
}) {
  const slugs = useProjectSlugs(client, "acme", ids);
  return <text>{`${label}:${[...slugs.values()].join(",")}`}</text>;
}

test("the API asks for lightweight summaries and retains only id and slug", async () => {
  const { client, requests } = projectClient();
  const projects = await listProjectReferences(client, { org: "acme", ids: ["42", "43"] });

  expect(projects).toEqual([
    { id: "42", slug: "backend" },
    { id: "43", slug: "frontend" },
  ]);
  expect(requests).toEqual([
    {
      ids: ["42", "43"],
      perPage: "2",
      collapse: ["latestDeploys", "unusedFeatures"],
      cursor: null,
      statsPeriod: null,
    },
  ]);
});

test("lookups larger than one response are chunked by referenced ids", async () => {
  const { client, requests } = projectClient();
  const ids = Array.from({ length: 101 }, (_, index) => String(index + 1));

  await listProjectReferences(client, { org: "acme", ids });

  expect(requests.map((request) => request.ids.length)).toEqual([100, 1]);
  expect(requests.every((request) => request.perPage === String(request.ids.length))).toBe(true);
  expect(requests.every((request) => request.cursor === null)).toBe(true);
});

test("concurrent mounts share one targeted request and a remount reuses it", async () => {
  const { client, requests } = projectClient();
  const first = await renderHarness(
    <box>
      <ProjectProbe client={client} label="one" ids={["42", "43"]} />
      <ProjectProbe client={client} label="two" ids={["43", "42"]} />
    </box>,
    { width: 60, height: 4 },
  );
  try {
    await first.waitForFrame(
      (frame) => frame.includes("one:backend,frontend") && frame.includes("two:backend,frontend"),
    );
    expect(requests).toHaveLength(1);
  } finally {
    await first.cleanup();
  }

  const remounted = await renderHarness(
    <ProjectProbe client={client} label="three" ids={["42", "43"]} />,
    { width: 60, height: 2 },
  );
  try {
    await remounted.waitForFrame((frame) => frame.includes("three:backend,frontend"));
    expect(requests).toHaveLength(1);
  } finally {
    await remounted.cleanup();
  }
});

test("a later lookup requests only ids absent from the session cache", async () => {
  const { client, requests } = projectClient();
  const first = await renderHarness(<ProjectProbe client={client} label="one" ids={["42"]} />);
  await first.waitForFrame((frame) => frame.includes("one:backend"));
  await first.cleanup();

  const second = await renderHarness(
    <ProjectProbe client={client} label="two" ids={["42", "43"]} />,
  );
  try {
    await second.waitForFrame((frame) => frame.includes("two:backend,frontend"));
    expect(requests.map((request) => request.ids)).toEqual([["42"], ["43"]]);
  } finally {
    await second.cleanup();
  }
});

test("failed ids are evicted so a later mount retries", async () => {
  const { client, requests } = projectClient({ failProjects: 1 });
  const failed = await renderHarness(<ProjectProbe client={client} label="failed" ids={["42"]} />);
  await failed.waitForFrame(() => requests.length === 1);
  await failed.wait(10);
  await failed.cleanup();

  const retried = await renderHarness(
    <ProjectProbe client={client} label="retried" ids={["42"]} />,
  );
  try {
    await retried.waitForFrame((frame) => frame.includes("retried:backend"));
    expect(requests).toHaveLength(2);
  } finally {
    await retried.cleanup();
  }
});

test("WorkflowList resolves only the projects its detectors reference", async () => {
  const { client, requests } = projectClient({ workflows: true });
  const h = await renderHarness(
    <App onQuit={() => {}} client={client} org="acme" initialScreen="monitors.alerts" />,
    { width: 120, height: 30 },
  );
  try {
    await h.waitForFrame((frame) => frame.includes("backend, frontend"));
    expect(h.frame()).toContain("Page on-call for checkout");
    expect(requests.map((request) => request.ids)).toEqual([["42", "43"]]);
    expect(requests[0]?.cursor).toBeNull();
  } finally {
    await h.cleanup();
  }
});
