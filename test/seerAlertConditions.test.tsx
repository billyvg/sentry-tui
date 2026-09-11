import { expect, test } from "bun:test";

import { createTokenAuthProvider } from "~/api/auth";
import { SentryClient } from "~/api/client";
import type { Workflow } from "~/api/workflows";
import { SeerBlockEmbed } from "~/ui/components/SeerEmbeds";
import { useOrganizationMembers } from "~/ui/hooks/useOrganizationMembers";
import { renderHarness } from "./helpers";

const workflow: Workflow = {
  id: "881",
  name: "Notify owners",
  enabled: true,
  detectorIds: [],
  triggers: {
    id: "t1",
    logicType: "any",
    conditions: [
      { id: "1", type: "assigned_to", comparison: { targetType: "Team", targetIdentifier: 7 } },
    ],
  },
  actionFilters: [
    {
      id: "f1",
      logicType: "all",
      conditions: [
        {
          id: "2",
          type: "assigned_to",
          comparison: { targetType: "Member", targetIdentifier: 42 },
        },
        { id: "3", type: "assigned_to", comparison: { targetType: "Team", targetIdentifier: 8 } },
        {
          id: "4",
          type: "event_frequency_count",
          comparison: {
            value: 100,
            interval: "1h",
            filters: [{ type: "tagged_event" }, { type: "level" }],
          },
        },
      ],
    },
  ],
};

/** A second consumer proves alert cards share the existing account directory. */
function ExistingMemberConsumer({ client }: { client: SentryClient }) {
  useOrganizationMembers(client, "acme");
  return null;
}

/** Serve deterministic directory responses, including a paginated team batch. */
function clientForAlert({ fail = false, rule = workflow } = {}) {
  const requests: URL[] = [];
  const client = new SentryClient({
    auth: createTokenAuthProvider({ token: "sntryu_test" }),
    maxRetries: 0,
    fetchImpl: (async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      let body: unknown = rule;
      let status = 200;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (url.pathname.endsWith("/users/")) {
        body = [
          {
            id: "membership-999",
            email: "owner@example.com",
            name: "Owner",
            user: { id: "42", email: "owner@example.com" },
          },
        ];
        if (fail) status = 403;
      }
      if (url.pathname.endsWith("/teams/")) {
        if (fail) status = 403;
        if (url.searchParams.has("cursor")) {
          body = [null, { id: "8", slug: "frontend" }, { id: "ignored" }];
        } else {
          body = [{ id: "7", slug: "backend" }];
          headers.Link =
            '<https://sentry.io/api/0/organizations/acme/teams/?cursor=next>; rel="next"; results="true"; cursor="next"';
        }
      }
      return new Response(JSON.stringify(body), { status, headers });
    }) as typeof fetch,
  });
  return { client, requests };
}

test("alert cards resolve account ids and batch team ids, sharing requests across cards", async () => {
  const { client, requests } = clientForAlert();
  const h = await renderHarness(
    <box flexDirection="column">
      <ExistingMemberConsumer client={client} />
      {[1, 2].map((key) => (
        <SeerBlockEmbed
          key={key}
          name="alert"
          data={{ id: "881", kind: "issue" }}
          width={100}
          client={client}
          org="acme"
        />
      ))}
    </box>,
    { width: 100, height: 60 },
  );
  try {
    await h.waitForFrame((frame) => frame.includes("team #frontend"));
    expect(h.frame()).toContain("team #backend");
    expect(h.frame()).toContain("member owner@example.com");
    expect(h.frame()).toContain("[2 subfilters] Number of events");
    expect(requests.filter((url) => url.pathname.endsWith("/users/"))).toHaveLength(1);
    const teams = requests.filter((url) => url.pathname.endsWith("/teams/"));
    expect(teams).toHaveLength(2);
    expect(teams.map((url) => url.searchParams.get("query"))).toEqual(["id:7 id:8", "id:7 id:8"]);
    expect(teams[1]?.searchParams.get("cursor")).toBe("next");
  } finally {
    await h.cleanup();
  }
});

test("unavailable directories retain explicit assignee ids without hiding the alert", async () => {
  const { client } = clientForAlert({ fail: true });
  const h = await renderHarness(
    <SeerBlockEmbed
      name="alert"
      data={{ id: "881", kind: "issue" }}
      width={100}
      client={client}
      org="acme"
    />,
  );
  try {
    await h.waitForFrame((frame) => frame.includes("member ID 42"));
    expect(h.frame()).toContain("team ID 7");
    expect(h.frame()).toContain("Notify owners");
  } finally {
    await h.cleanup();
  }
});

test("subfilter qualification survives narrow card clipping without fetching unused directories", async () => {
  const { client, requests } = clientForAlert({
    rule: {
      ...workflow,
      triggers: null,
      actionFilters: [{ id: "f1", conditions: [workflow.actionFilters![0]!.conditions![2]!] }],
    },
  });
  const h = await renderHarness(
    <SeerBlockEmbed
      name="alert"
      data={{ id: "881", kind: "issue" }}
      width={40}
      client={client}
      org="acme"
    />,
    { width: 40 },
  );
  try {
    await h.waitForFrame((frame) => frame.includes("[2 subfilters]"));
    expect(requests).toHaveLength(1);
  } finally {
    await h.cleanup();
  }
});
