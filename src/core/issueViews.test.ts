import { describe, expect, test } from "bun:test";

import { SORT_OPTIONS } from "~/api/issues";
import { ALL_VIEWS_LABEL, getIssueView, ISSUE_VIEWS } from "~/core/issueViews";
import { getNavGroup } from "~/core/nav";

const ISSUES_ITEMS = getNavGroup("issues").sections.flatMap((section) => section.items);

describe("issue views", () => {
  test("every Issues nav item except All Views resolves to a query", () => {
    const unmapped = ISSUES_ITEMS.filter(
      (item) => item !== ALL_VIEWS_LABEL && getIssueView(item) === undefined,
    );
    expect(unmapped).toEqual([]);
  });

  test("All Views is deliberately not a query view", () => {
    expect(ISSUES_ITEMS).toContain(ALL_VIEWS_LABEL);
    expect(getIssueView(ALL_VIEWS_LABEL)).toBeUndefined();
  });

  test("no view is defined for a label the nav does not render", () => {
    const orphans = ISSUE_VIEWS.map((view) => view.label).filter(
      (label) => !ISSUES_ITEMS.includes(label),
    );
    expect(orphans).toEqual([]);
  });

  test("every view carries a non-empty query and description", () => {
    for (const view of ISSUE_VIEWS) {
      expect(view.query.length).toBeGreaterThan(0);
      expect(view.description.length).toBeGreaterThan(0);
    }
  });

  test("view sorts are values the API accepts", () => {
    const allowed = SORT_OPTIONS.map((option) => option.value);
    for (const view of ISSUE_VIEWS) {
      if (view.sort) expect(allowed).toContain(view.sort);
    }
  });
});
