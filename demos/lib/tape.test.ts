import { describe, expect, test } from "bun:test";

import { parseNarration } from "./narration.ts";
import { buildGotoHotkeys } from "~/core/goto";
import type { NavGroupId } from "~/core/nav";
import { findScreen } from "~/core/screens";
import { SCREEN_COMPONENTS } from "~/ui/screens/registry";

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

describe("Meanwhile", () => {
  const tape = parseTape(`
    Meanwhile @B01
      Key n
      Sleep 500ms
      Key i
    End
    Wait @B02
  `);

  test("collects its steps instead of emitting them inline", () => {
    expect(tape.steps).toHaveLength(2);
    expect(tape.steps[0]).toMatchObject({
      kind: "meanwhile",
      beat: "B01",
      steps: [
        { kind: "key", chord: "n" },
        { kind: "sleep", ms: 500 },
        { kind: "key", chord: "i" },
      ],
    });
  });

  test("lasts the longer of the beat and its own steps", () => {
    // Beat longer than the block: the block holds the rest of the line.
    expect(timeline(tape, { B01: 4, B02: 1 })[0]).toMatchObject({ holdMs: 4000 });
    // Block longer than the beat: the actions still get to finish.
    expect(timeline(tape, { B01: 0.2, B02: 1 })[0]).toMatchObject({ holdMs: 500 });
  });

  test("counts as waiting on its beat", () => {
    expect(beatsInTape(tape)).toEqual(["B01", "B02"]);
  });

  test("an unclosed block names its line", () => {
    expect(() => parseTape("Meanwhile @B01\n  Key n")).toThrow("never closed");
    expect(() => parseTape("Meanwhile @B01\n  Key n")).toThrow("line 1");
  });

  test("blocks cannot nest", () => {
    expect(() => parseTape("Meanwhile @B01\nMeanwhile @B02\nEnd\nEnd")).toThrow("cannot nest");
  });

  test("End without a block is an error", () => {
    expect(() => parseTape("End")).toThrow("End without a Meanwhile");
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

  test("reads a per-beat Emphasis override, and never speaks it", () => {
    const [beat] = parseNarration(
      "### B01 · sign-off\n\n**Screen:** a prompt.\n**Emphasis:** 0.9\n\n> The punchline.\n",
    );
    expect(beat?.emphasis).toBe(0.9);
    expect(beat?.text).toBe("The punchline.");
  });

  test("a beat with no Emphasis reads at the same pace as the rest", () => {
    const [beat] = parseNarration("### B01 · plain\n\n> Just a line.\n");
    expect(beat?.emphasis).toBeUndefined();
  });

  test("an unusable Emphasis is an error rather than a silent default", () => {
    expect(() => parseNarration("### B01 · x\n\n**Emphasis:** nope\n\n> Line.\n")).toThrow(
      "unusable Emphasis",
    );
    expect(() => parseNarration("### B01 · x\n\n**Emphasis:** 0\n\n> Line.\n")).toThrow(
      "unusable Emphasis",
    );
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

  test("every goto sequence in the tape lands on a screen that exists", async () => {
    const source = await Bun.file(new URL("../demo.tape", import.meta.url)).text();
    const steps = parseTape(source).steps;

    // Most navigation lives inside `Meanwhile` blocks, so the scan has to
    // descend into them — a flat pass finds nothing and passes vacuously.
    const flat = steps.flatMap((step) => (step.kind === "meanwhile" ? step.steps : [step]));

    // `n` opens goto mode; the next two keystrokes are a group and an item.
    // Sleeps between them are the tape letting the printed keys land on screen.
    const sequences: Array<{ line: number; keys: string[] }> = [];
    flat.forEach((step, i) => {
      if (step.kind !== "key" || step.chord !== "n") return;
      const keys: string[] = [];
      for (const next of flat.slice(i + 1)) {
        if (next.kind === "sleep") continue;
        if (next.kind !== "key" || keys.length === 2) break;
        keys.push(next.chord);
      }
      sequences.push({ line: step.line, keys });
    });

    expect(sequences.length).toBeGreaterThan(0);

    // Resolve each one the way the app would, and check a component is
    // registered for where it ends up — the nav offers keys for screens that
    // still render "Not implemented yet.", and one on camera is a bad look.
    const groupKeys = buildGotoHotkeys("issues").groups;
    const unreachable = sequences.filter(({ keys }) => {
      const [groupKey, itemKey] = keys;
      const group = [...groupKeys].find(([, hotkey]) => hotkey.key === groupKey)?.[0];
      if (!group) return true;
      const item = [...buildGotoHotkeys(group).items].find(
        ([, hotkey]) => hotkey.key === itemKey,
      )?.[0];
      if (!item) return true;
      const screen = findScreen(group, item);
      return !screen || !SCREEN_COMPONENTS[screen.id];
    });

    expect(unreachable).toEqual([]);
  });
});
