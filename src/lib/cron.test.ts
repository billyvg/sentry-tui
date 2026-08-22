import { describe, expect, test } from "bun:test";

import { crontabAsText, intervalAsText } from "~/lib/cron";

const STAR = "*";
/** A step field (`*` `/` `n`), spelled this way so it can sit in a comment. */
const every = (n: number) => `${STAR}/${n}`;

describe("crontabAsText", () => {
  const CASES: Array<[string, string]> = [
    ["* * * * *", "Every minute"],
    [`${every(15)} * * * *`, "Every 15 minutes"],
    [`${every(1)} * * * *`, "Every minute"],
    ["0 * * * *", "Every hour at :00"],
    ["30 * * * *", "Every hour at :30"],
    [`15 ${every(2)} * * *`, "Every 2 hours at :15"],
    [`0 ${every(1)} * * *`, "Every hour at :00"],
    ["0 9 * * *", "Every day at 09:00"],
    ["5 0 * * *", "Every day at 00:05"],
    ["30 6 * * 1-5", "Every Monday–Friday at 06:30"],
    ["30 6 * * MON-FRI", "Every Monday–Friday at 06:30"],
    ["0 12 * * 0", "Every Sunday at 12:00"],
    ["0 12 * * 7", "Every Sunday at 12:00"],
    ["0 12 * * 1,3", "Every Monday and Wednesday at 12:00"],
    ["0 12 * * 1,3,5", "Every Monday, Wednesday and Friday at 12:00"],
    ["0 3 1 * *", "Day 1 of every month at 03:00"],
    ["0 3 1 1 *", "January 1 at 03:00"],
    ["@daily", "Every day at 00:00"],
    ["@hourly", "Every hour at :00"],
  ];

  for (const [expression, expected] of CASES) {
    test(`${expression} → ${expected}`, () => {
      expect(crontabAsText(expression)).toBe(expected);
    });
  }

  test("the nonstandard seconds column is ignored", () => {
    expect(crontabAsText("0 0 9 * * *")).toBe("Every day at 09:00");
  });

  test("an expression it cannot phrase comes back undefined, for the caller to show raw", () => {
    // A day-of-month step with a weekday restriction: correct English for this
    // needs a cron library, and the expression itself is more use than a wrong
    // phrase.
    expect(crontabAsText(`0 3 ${every(2)} * 1`)).toBeUndefined();
    expect(crontabAsText("nonsense")).toBeUndefined();
    expect(crontabAsText("")).toBeUndefined();
  });
});

describe("intervalAsText", () => {
  test("counts its unit", () => {
    expect(intervalAsText(15, "minute")).toBe("Every 15 minutes");
    expect(intervalAsText(2, "day")).toBe("Every 2 days");
  });

  test("drops the one", () => {
    expect(intervalAsText(1, "hour")).toBe("Every hour");
  });
});
