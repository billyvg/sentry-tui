import { expect, test } from "bun:test";

import { resultCountLabel } from "~/ui/components/ResultFooter";

test.each([
  [0, "issue", false, "0 issues"],
  [1, "issue", false, "1 issue"],
  [25, "issue", false, "25 issues"],
  [25, "issue", true, "25+ issues"],
  [1, "result", true, "1+ results"],
] as const)("formats a page count as %s %s (more: %s)", (count, noun, hasMore, expected) => {
  expect(resultCountLabel(count, noun, hasMore)).toBe(expected);
});
