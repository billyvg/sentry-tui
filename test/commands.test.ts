import { describe, expect, test } from "bun:test";

import {
  COMMANDS,
  formatKey,
  getCommand,
  matchesCommand,
  primaryKey,
} from "~/core/commands";

const key = (
  name: string,
  mods: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {},
) => ({ name, ...mods });

describe("matchesCommand", () => {
  test("matches a plain letter chord", () => {
    expect(matchesCommand("sentry.issue.resolve", key("r"))).toBe(true);
  });

  test("case distinguishes g from G", () => {
    // Regression: a bare "g" chord used to match shift+g, so "jump to top"
    // swallowed "jump to bottom" purely because it was declared first.
    expect(matchesCommand("sentry.nav.top", key("g"))).toBe(true);
    expect(matchesCommand("sentry.nav.top", key("g", { shift: true }))).toBe(
      false,
    );
    expect(matchesCommand("sentry.nav.bottom", key("g", { shift: true }))).toBe(
      true,
    );
    expect(matchesCommand("sentry.nav.bottom", key("g"))).toBe(false);
  });

  test("no two commands claim the same chord", () => {
    const probes = [
      key("g"),
      key("g", { shift: true }),
      key("r"),
      key("a"),
      key("a", { shift: true }),
      key("j"),
      key("k"),
      key("q"),
      key("d", { ctrl: true }),
      key("u", { ctrl: true }),
    ];

    for (const probe of probes) {
      const claimants = COMMANDS.filter((c) => matchesCommand(c.id, probe));
      expect(claimants.length).toBeLessThanOrEqual(1);
    }
  });

  test("modifier chords require their modifier", () => {
    expect(matchesCommand("sentry.nav.pageDown", key("d", { ctrl: true }))).toBe(
      true,
    );
    expect(matchesCommand("sentry.nav.pageDown", key("d"))).toBe(false);
  });

  test("named keys match without modifiers", () => {
    expect(matchesCommand("sentry.nav.open", key("return"))).toBe(true);
    expect(matchesCommand("sentry.nav.back", key("escape"))).toBe(true);
    expect(matchesCommand("sentry.app.focusNext", key("tab"))).toBe(true);
    expect(
      matchesCommand("sentry.app.focusPrev", key("tab", { shift: true })),
    ).toBe(true);
  });

  test("an unknown command matches nothing", () => {
    expect(matchesCommand("nope", key("r"))).toBe(false);
  });
});

describe("catalog", () => {
  test("ids are unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every command has at least one binding and a title", () => {
    for (const command of COMMANDS) {
      expect(command.defaultKeys.length).toBeGreaterThan(0);
      expect(command.title.length).toBeGreaterThan(0);
    }
  });

  test("primaryKey returns the first chord, empty for unknown ids", () => {
    expect(primaryKey("sentry.issue.resolve")).toBe("r");
    expect(primaryKey("nope")).toBe("");
  });

  test("formatKey renders readable labels", () => {
    expect(formatKey("return")).toBe("enter");
    expect(formatKey("escape")).toBe("esc");
    expect(formatKey("r")).toBe("r");
  });

  test("getCommand looks up by id", () => {
    expect(getCommand("sentry.app.quit")?.title).toBe("Quit");
    expect(getCommand("nope")).toBeUndefined();
  });
});
