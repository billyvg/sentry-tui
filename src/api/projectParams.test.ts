import { expect, test } from "bun:test";

import { projectParams } from "~/api/projectParams";

test("an empty project selection means every accessible project", () => {
  expect(projectParams()).toEqual(["-1"]);
  expect(projectParams([])).toEqual(["-1"]);
});

test("an explicit project selection is preserved", () => {
  expect(projectParams(["frontend", "42"])).toEqual(["frontend", "42"]);
});
