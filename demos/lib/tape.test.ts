import { describe, expect, test } from "bun:test";

import { parseNarration } from "./narration.ts";
import { buildGotoHotkeys } from "~/core/goto";
import type { NavGroupId } from "~/core/nav";

import { beatsInTape, parseDuration, parseTape, TapeError, timeline } from "./tape.ts";

describe("parseDuration", () => {
  test("reads seconds and milliseconds", () => {
    expect(parseDuration("800ms", 1)).toBe(800);
    expect(parseDuration("2s", 1)).toBe(2000);
    expect(parseDuration("1.5s", 1)).toBe(1500);
    expect(parseDuration("250", 1)).toBe(250);
  });

  test("rejects anything else", () => {
    expect(() => parseDuration("soon", 7)).toThrow(TapeError);
    expect(() => parseDuration("soon", 7)).toThrow("line 7");
  });
});

describe("parseTape", () => {
  test("reads settings, env and steps", () => {
    const tape = parseTape(`
      # a comment
      Set Columns 120
      Set FontSize 20
      Env SENTRY_TUI_LATENCY 900

      Type \`sentry-tui\`
      Key enter
      Key j 3
      Sleep 500ms
      Wait @B04
    `);

    expect(tape.settings.columns).toBe(120);
    expect(tape.settings.fontSize).toBe(20);
    // Untouched settings keep their default.
    expect(tape.settings.rows).toBe(44);
    expect(tape.env["SENTRY_TUI_LATENCY"]).toBe("900");

    expect(tape.steps).toEqual([
      { kind: "type", text: "sentry-tui", line: 7 },
      { kind: "key", chord: "enter", count: 1, line: 8 },
      { kind: "key", chord: "j", count: 3, line: 9 },
      { kind: "sleep", ms: 500, line: 10 },
      { kind: "wait", beat: "B04", line: 11 },
    ]);
  });

  test("Type keeps quotes that belong to the command", () => {
    const tape = parseTape('Type `echo "hello"`');
    expect(tape.steps[0]).toMatchObject({ kind: "type", text: 'echo "hello"' });
  });

  test("an unknown verb names its line", () => {
    expect(() => parseTape("Set Columns 80\nFrobnicate 3")).toThrow("line 2");
  });

  test("Wait needs a beat id", () => {
    expect(() => parseTape("Wait soon")).toThrow(TapeError);
  });
});

describe("timeline", () => {
  const tape = parseTape(`
    Type \`x\`
    Wait @B01
    Sleep 500ms
    Wait @B02
  `);

  test("places each step at the offset its action happens", () => {
    const plan = timeline(tape, { B01: 2, B02: 3 });

    // Typing is instantaneous — the hold that follows is what takes time.
    expect(plan[0]).toMatchObject({ atMs: 0, holdMs: 0 });
    expect(plan[1]).toMatchObject({ atMs: 0, holdMs: 2000 });
    expect(plan[2]).toMatchObject({ atMs: 2000, holdMs: 500 });
    // B02 starts after B01's audio *and* the gap — this is the case that makes
    // concatenating the audio wrong.
    expect(plan[3]).toMatchObject({ atMs: 2500, holdMs: 3000 });
  });

  test("falls back for a beat that has not been synthesized yet", () => {
    const plan = timeline(tape, {}, 1234);
    expect(plan[1]).toMatchObject({ holdMs: 1234 });
  });

  test("lists the beats it waits on, in order", () => {
    expect(beatsInTape(tape)).toEqual(["B01", "B02"]);
  });
});

describe("parseNarration", () => {
  const source = `
# Title

Intro prose.

### B01 · first beat

**Screen:** something happens.

> The first line.
> Still the first line.

### B02 · second beat \`[CUT]\`

> The second line.

## Fidelity notes

> This blockquote is not narration.
`;

  test("reads each beat's blockquote and nothing else", () => {
    const beats = parseNarration(source);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toEqual({
      id: "B01",
      title: "first beat",
      text: "The first line. Still the first line.",
      optional: false,
    });
  });

  test("marks [CUT] beats optional and keeps the tag out of the title", () => {
    const [, second] = parseNarration(source);
    expect(second?.optional).toBe(true);
    expect(second?.title).toBe("second beat");
  });

  test("a beat with no blockquote is an error, not a silent gap", () => {
    expect(() => parseNarration("### B01 · empty\n\nJust a stage direction.\n")).toThrow(
      "no narration blockquote",
    );
  });
});

describe("the real demo", () => {
  test("every beat the tape waits on exists in the narration", async () => {
    const tape = parseTape(await Bun.file(new URL("../demo.tape", import.meta.url)).text());
    const beats = parseNarration(
      await Bun.file(new URL("../narration.md", import.meta.url)).text(),
    );
    const known = new Set(beats.map((beat) => beat.id));

    const missing = beatsInTape(tape).filter((id) => !known.has(id));
    expect(missing).toEqual([]);
  });

  test("the tape waits on each beat at most once", async () => {
    // A beat waited on twice gets its audio placed twice by `mux` — an echo in
    // the finished cut rather than a crash, so it has to be caught here.
    const tape = parseTape(await Bun.file(new URL("../demo.tape", import.meta.url)).text());
    const waited = beatsInTape(tape);
    const duplicated = waited.filter((id, i) => waited.indexOf(id) !== i);
    expect(duplicated).toEqual([]);
  });
});

describe("goto keys the tape depends on", () => {
  // Goto keys are assigned at runtime from the nav *labels*, so renaming an item
  // silently repoints a tape step at a different destination — or at a nav
  // section that renders "Not implemented yet." on camera. These pin the ones
  // demo.tape actually presses.
  const keyForGroup = (group: NavGroupId, target: NavGroupId) =>
    buildGotoHotkeys(group).groups.get(target)?.key;
  const keyForItem = (group: NavGroupId, label: string) =>
    buildGotoHotkeys(group).items.get(label)?.key;

  test("group keys", () => {
    expect(keyForGroup("issues", "issues")).toBe("i");
    expect(keyForGroup("issues", "explore")).toBe("e");
    expect(keyForGroup("issues", "seer")).toBe("s");
  });

  test("item keys, per open group", () => {
    expect(keyForItem("issues", "Feed")).toBe("f");
    expect(keyForItem("issues", "Inbox")).toBe("b");
    expect(keyForItem("issues", "All Views")).toBe("v");
    expect(keyForItem("explore", "Logs")).toBe("l");
    expect(keyForItem("seer", "Ask Seer")).toBe("a");
  });

  test("the tape only presses goto keys that lead somewhere implemented", async () => {
    const source = await Bun.file(new URL("../demo.tape", import.meta.url)).text();
    const steps = parseTape(source).steps;

    // Only Issues, Explore › Logs and Seer have real screens; the rest of the
    // nav renders "Not implemented yet." and must not appear on camera.
    const implemented = new Set(["i", "f", "b", "v", "e", "l", "s", "a"]);

    // Every `Key n` opens goto mode; the next one or two keystrokes choose the
    // destination. Sleeps are skipped rather than treated as terminators —
    // there is always one between the keys, to let the printed hotkeys land on
    // screen before the next press.
    const pressed: Array<{ line: number; chord: string }> = [];
    steps.forEach((step, i) => {
      if (step.kind !== "key" || step.chord !== "n") return;
      let taken = 0;
      for (const next of steps.slice(i + 1)) {
        if (next.kind === "sleep") continue;
        if (next.kind !== "key" || taken === 2) break;
        pressed.push({ line: next.line, chord: next.chord });
        taken++;
      }
    });

    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.filter(({ chord }) => !implemented.has(chord))).toEqual([]);
  });
});
