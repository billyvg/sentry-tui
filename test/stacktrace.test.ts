import { describe, expect, test } from "bun:test";

import type { Frame, StacktraceType } from "~/api/types";
import {
  buildStackRows,
  filetypeFor,
  formatFrameTitle,
  frameIsExpandable,
  frameIsVisible,
  isRepeatedFrame,
} from "~/lib/stacktrace";

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    filename: "app.js",
    absPath: null,
    module: null,
    package: null,
    function: "run",
    rawFunction: null,
    symbol: null,
    lineNo: 1,
    colNo: null,
    inApp: false,
    platform: null,
    context: [],
    vars: null,
    ...overrides,
  };
}

function stack(frames: Frame[]): StacktraceType {
  return {
    frames,
    framesOmitted: null,
    hasSystemFrames: true,
    registers: null,
  };
}

describe("frameIsVisible", () => {
  test("in-app frames always show", () => {
    expect(frameIsVisible(frame({ inApp: true }), undefined, false)).toBe(true);
  });

  test("a system frame leading into app code shows", () => {
    const system = frame({ inApp: false });
    expect(frameIsVisible(system, frame({ inApp: true }), false)).toBe(true);
  });

  test("a system frame between system frames folds", () => {
    expect(frameIsVisible(frame(), frame(), false)).toBe(false);
  });

  test("the last frame always shows, even if it is a system frame", () => {
    expect(frameIsVisible(frame(), undefined, false)).toBe(true);
  });

  test("includeSystemFrames overrides folding", () => {
    expect(frameIsVisible(frame(), frame(), true)).toBe(true);
  });
});

describe("isRepeatedFrame", () => {
  test("identical location and function is a repeat", () => {
    expect(isRepeatedFrame(frame(), frame())).toBe(true);
  });

  test("a different line is not a repeat", () => {
    expect(isRepeatedFrame(frame({ lineNo: 1 }), frame({ lineNo: 2 }))).toBe(false);
  });

  test("nothing repeats against a missing frame", () => {
    expect(isRepeatedFrame(frame(), undefined)).toBe(false);
  });
});

describe("buildStackRows", () => {
  test("folds a run of system frames onto the next visible frame", () => {
    const rows = buildStackRows(
      stack([
        frame({ function: "sys1" }),
        frame({ function: "sys2" }),
        frame({ function: "sys3" }),
        frame({ function: "app", inApp: true }),
      ]),
      { newestFirst: false },
    );

    // sys3 is visible (it leads into app code); sys1 and sys2 fold onto it.
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.kind).toBe("frame");
    if (first.kind === "frame") {
      expect(first.frame.function).toBe("sys3");
      expect(first.hiddenBefore).toBe(2);
    }
  });

  test("collapses consecutive identical frames into a count", () => {
    const recursive = frame({ function: "recurse", inApp: true });
    const rows = buildStackRows(stack([recursive, { ...recursive }, { ...recursive }]), {
      newestFirst: false,
    });

    expect(rows).toHaveLength(1);
    if (rows[0]!.kind === "frame") expect(rows[0]!.repeats).toBe(2);
  });

  test("newestFirst reverses the display order", () => {
    const rows = buildStackRows(
      stack([frame({ function: "outer", inApp: true }), frame({ function: "inner", inApp: true })]),
      { newestFirst: true },
    );

    expect(rows).toHaveLength(2);
    if (rows[0]!.kind === "frame") expect(rows[0]!.frame.function).toBe("inner");
  });

  test("includeSystemFrames shows everything unfolded", () => {
    const frames = [frame(), frame({ function: "b" }), frame({ function: "c" })];
    const folded = buildStackRows(stack(frames), { newestFirst: false });
    const full = buildStackRows(stack(frames), {
      includeSystemFrames: true,
      newestFirst: false,
    });

    expect(full.length).toBeGreaterThan(folded.length);
    expect(full).toHaveLength(3);
  });

  test("emits a marker for server-omitted frames", () => {
    const rows = buildStackRows(
      { ...stack([frame({ inApp: true })]), framesOmitted: [3, 40] },
      { newestFirst: false },
    );
    expect(rows.some((r) => r.kind === "omitted")).toBe(true);
  });

  test("an empty or missing stacktrace yields no rows", () => {
    expect(buildStackRows(null)).toEqual([]);
    expect(buildStackRows(stack([]))).toEqual([]);
  });
});

describe("formatFrameTitle", () => {
  test("composes filename, function and position", () => {
    expect(
      formatFrameTitle(frame({ filename: "app.tsx", function: "render", lineNo: 42, colNo: 13 })),
    ).toBe("app.tsx in render at line 42:13");
  });

  test("omits the column when absent", () => {
    expect(formatFrameTitle(frame({ filename: "a.js", function: "f", lineNo: 7 }))).toBe(
      "a.js in f at line 7",
    );
  });

  test("suppresses line 0, the native no-source-info convention", () => {
    expect(formatFrameTitle(frame({ lineNo: 0 }))).toBe("app.js in run");
  });

  test("falls back to the module, then to a placeholder", () => {
    expect(
      formatFrameTitle(
        frame({ filename: null, module: "com.acme.Thing", function: null, lineNo: null }),
      ),
    ).toBe("com.acme.Thing");
    expect(
      formatFrameTitle(frame({ filename: null, module: null, function: null, lineNo: null })),
    ).toBe("<unknown>");
  });
});

describe("frame helpers", () => {
  test("expandable when there is source context or variables", () => {
    expect(frameIsExpandable(frame())).toBe(false);
    expect(frameIsExpandable(frame({ context: [[1, "x"]] }))).toBe(true);
    expect(frameIsExpandable(frame({ vars: { a: 1 } }))).toBe(true);
    expect(frameIsExpandable(frame({ vars: {} }))).toBe(false);
  });

  test("maps filenames to bundled grammars only", () => {
    expect(filetypeFor(frame({ filename: "a.tsx" }))).toBe("tsx");
    expect(filetypeFor(frame({ filename: "a.ts" }))).toBe("typescript");
    expect(filetypeFor(frame({ filename: "a.js" }))).toBe("javascript");
    // No bundled grammar — renders unhighlighted rather than failing.
    expect(filetypeFor(frame({ filename: "a.py" }))).toBeUndefined();
  });
});
