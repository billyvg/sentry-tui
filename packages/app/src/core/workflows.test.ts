import { describe, expect, test } from "bun:test";

import type { Workflow, WorkflowCondition } from "~/api/workflows";
import {
  workflowActionText,
  workflowConditionLines,
  workflowConditionText,
  workflowThrottleText,
} from "~/core/workflows";

/** A workflow with only the fields a case is about. */
function workflow(overrides: Partial<Workflow>): Workflow {
  return {
    id: "881",
    name: "Notify on checkout errors",
    enabled: true,
    detectorIds: [],
    actionFilters: null,
    ...overrides,
  };
}

/** One condition, with the comparison the type in question actually sends. */
function condition(type: string, comparison?: unknown): WorkflowCondition {
  return { id: "1", type, ...(comparison === undefined ? {} : { comparison }) };
}

describe("workflowConditionText", () => {
  test("a trigger with nothing to compare is a sentence on its own", () => {
    expect(workflowConditionText(condition("first_seen_event"))).toBe("A new issue is created");
    expect(workflowConditionText(condition("regression_event"))).toBe("A resolved issue regresses");
  });

  test("age and occurrence filters read their comparison back", () => {
    expect(
      workflowConditionText(
        condition("age_comparison", { comparisonType: "older", value: 10, time: "minute" }),
      ),
    ).toBe("The issue is older than 10 minutes");
    expect(workflowConditionText(condition("issue_occurrences", { value: 25 }))).toBe(
      "The issue has happened at least 25 times",
    );
  });

  test("match-based filters name the operator, and drop the value when it takes none", () => {
    expect(
      workflowConditionText(condition("tagged_event", { key: "env", match: "eq", value: "prod" })),
    ).toBe("The event's env tag equals prod");
    expect(workflowConditionText(condition("tagged_event", { key: "env", match: "is" }))).toBe(
      "The event's env tag is set",
    );
    expect(
      workflowConditionText(
        condition("event_attribute", { attribute: "http.url", match: "co", value: "/checkout" }),
      ),
    ).toBe("The event's http.url attribute contains /checkout");
  });

  test("levels, priorities and categories are looked up, not printed as numbers", () => {
    expect(workflowConditionText(condition("level", { match: "gte", level: 40 }))).toBe(
      "The event's level greater than or equal error",
    );
    expect(workflowConditionText(condition("issue_priority_greater_or_equal", 75))).toBe(
      "Current issue priority is at least high",
    );
    expect(workflowConditionText(condition("issue_category", { value: 1, include: false }))).toBe(
      "Issue category is not equal to error",
    );
  });

  test("the four frequency pairs share two sentences", () => {
    expect(
      workflowConditionText(condition("event_frequency_count", { value: 100, interval: "1h" })),
    ).toBe("Number of events in an issue is more than 100 in one hour");
    expect(
      workflowConditionText(
        condition("event_unique_user_frequency_percent", {
          value: 50,
          interval: "1h",
          comparisonInterval: "1d",
        }),
      ),
    ).toBe(
      "Number of users affected by an issue is 50% higher in one hour compared to one day ago",
    );
    expect(
      workflowConditionText(condition("percent_sessions_count", { value: 5, interval: "30m" })),
    ).toBe("Percentage of sessions affected by an issue is more than 5 in 30 minutes");
  });

  test("every frequency family qualifies its subfilters, including unknown future shapes", () => {
    for (const family of [
      "event_frequency",
      "event_unique_user_frequency",
      "event_unique_user_frequency_with_conditions",
      "percent_sessions",
    ]) {
      for (const threshold of ["count", "percent"]) {
        const type = `${family}_${threshold}`;
        expect(
          workflowConditionText(condition(type, { value: 1, filters: [{ future: true }] })),
        ).toStartWith("[1 subfilter] ");
        expect(workflowConditionText(condition(type, { value: 1, filters: [] }))).not.toContain(
          "subfilter",
        );
        expect(workflowConditionText(condition(type, { value: 1, filters: null }))).not.toContain(
          "subfilter",
        );
      }
    }
  });

  test("missing assignee names retain their ids and unassigned remains explicit", () => {
    expect(
      workflowConditionText(
        condition("assigned_to", { targetType: "Member", targetIdentifier: 42 }),
      ),
    ).toBe("The issue is assigned to member ID 42");
    expect(workflowConditionText(condition("assigned_to", { targetType: "Team" }))).toBe(
      "The issue is assigned to team unknown",
    );
    expect(workflowConditionText(condition("assigned_to", { targetType: "Unassigned" }))).toBe(
      "The issue is unassigned",
    );
  });

  test("an unrecognised condition type still says what it is", () => {
    expect(workflowConditionText(condition("some_new_trigger"))).toBe("some new trigger");
    expect(workflowConditionText(condition("some_new_trigger", 12))).toBe("some new trigger 12");
  });
});

describe("workflowActionText", () => {
  test("an action names its integration and where it lands", () => {
    expect(
      workflowActionText({ id: "1", type: "slack", config: { targetDisplay: "#checkout" } }),
    ).toBe("Slack — #checkout");
    expect(workflowActionText({ id: "2", type: "email" })).toBe("Email");
    expect(workflowActionText({ id: "3", type: "webhook", status: "disabled" })).toBe(
      "Webhook (disabled)",
    );
  });
});

describe("workflowConditionLines", () => {
  const FULL = workflow({
    triggers: {
      id: "t1",
      logicType: "any-short",
      conditions: [condition("first_seen_event"), condition("regression_event")],
    },
    actionFilters: [
      {
        id: "f1",
        logicType: "all",
        conditions: [condition("issue_priority_greater_or_equal", 75)],
        actions: [{ id: "a1", type: "slack", config: { targetDisplay: "#checkout" } }],
      },
    ],
  });

  test("the three groups come back as headings with their members under them", () => {
    expect(workflowConditionLines(FULL)).toEqual([
      { heading: true, text: "When any of the following occur" },
      { heading: false, text: "A new issue is created" },
      { heading: false, text: "A resolved issue regresses" },
      { heading: true, text: "If all of these filters match" },
      { heading: false, text: "Current issue priority is at least high" },
      { heading: true, text: "Then perform these actions" },
      { heading: false, text: "Slack — #checkout" },
    ]);
  });

  test("an empty trigger group means any activity, not no trigger", () => {
    const lines = workflowConditionLines(workflow({ triggers: null }));
    expect(lines[0]).toEqual({
      heading: true,
      text: "When an event or issue activity is captured",
    });
  });

  test("an action filter with no filters or actions says so rather than going blank", () => {
    const lines = workflowConditionLines(
      workflow({ actionFilters: [{ id: "f1", logicType: "all" }] }),
    );
    expect(lines.map((line) => line.text)).toContain("Any event");
    expect(lines.map((line) => line.text)).toContain("No actions configured");
  });

  test("a workflow longer than the card is summarised, never silently truncated", () => {
    const lines = workflowConditionLines(FULL, 4);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toEqual({ heading: false, text: "…and 3 more lines" });
  });
});

describe("workflowThrottleText", () => {
  test("an absent frequency is every trigger", () => {
    expect(workflowThrottleText(workflow({}))).toBe("Every trigger");
    expect(workflowThrottleText(workflow({ config: { frequency: 0 } }))).toBe("Every trigger");
  });

  test("minutes roll up into the largest whole unit that fits", () => {
    expect(workflowThrottleText(workflow({ config: { frequency: 30 } }))).toBe("30 minutes");
    expect(workflowThrottleText(workflow({ config: { frequency: 60 } }))).toBe("1 hour");
    expect(workflowThrottleText(workflow({ config: { frequency: 90 } }))).toBe("90 minutes");
    expect(workflowThrottleText(workflow({ config: { frequency: 1440 } }))).toBe("1 day");
  });
});
