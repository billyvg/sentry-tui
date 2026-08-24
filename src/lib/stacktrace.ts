/**
 * Frame folding, ported from `components/events/interfaces/utils.tsx` and
 * `crashContent/stackTrace/content.tsx`.
 *
 * Collapsing system frames is what makes a stack trace readable: without it a
 * JS trace is mostly framework internals and the one line you care about is
 * buried.
 *
 * The frame and stacktrace shapes are declared structurally rather than
 * imported from `~/api/types` so this stays a dependency-free leaf module;
 * `Frame` and `StacktraceLike` are assignable to them.
 */

/** The subset of a Sentry frame this module reasons about. */
export interface FrameLike {
  filename: string | null;
  absPath: string | null;
  module: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  inApp: boolean;
  context: ReadonlyArray<readonly [number, string | null]>;
  vars: Record<string, unknown> | null;
}

export interface StacktraceLike<F extends FrameLike = FrameLike> {
  frames?: F[];
  /** Inclusive `[start, end]` range of frames the server dropped. */
  framesOmitted: readonly [number, number] | null;
}

/**
 * A frame is shown when it's in-app, when it leads into app code, or when it's
 * the very last frame. Everything else folds.
 */
export function frameIsVisible(
  frame: FrameLike,
  nextFrame: FrameLike | undefined,
  includeSystemFrames: boolean,
): boolean {
  return (
    includeSystemFrames ||
    frame.inApp ||
    (nextFrame?.inApp ?? false) ||
    (!frame.inApp && nextFrame === undefined)
  );
}

/** Consecutive identical frames collapse into a repeat count. */
export function isRepeatedFrame(frame: FrameLike, other: FrameLike | undefined): boolean {
  if (!other) return false;
  return (
    frame.filename === other.filename &&
    frame.function === other.function &&
    frame.lineNo === other.lineNo &&
    frame.colNo === other.colNo
  );
}

export interface StackRow {
  kind: "frame";
  frame: FrameLike;
  /** Original index, for stable keys and expansion state. */
  index: number;
  /** Extra occurrences collapsed into this row. */
  repeats: number;
  /** System frames folded *before* this row. */
  hiddenBefore: number;
}

export interface OmittedRow {
  kind: "omitted";
  from: number;
  to: number;
}

export type StackTraceRow = StackRow | OmittedRow;

/**
 * Flatten a stacktrace into display rows, folding system frames onto the next
 * visible frame and collapsing repeats.
 *
 * @param newestFirst reverse the frames — Sentry's default presentation
 */
export function buildStackRows(
  stacktrace: StacktraceLike | null | undefined,
  { includeSystemFrames = false, newestFirst = true } = {},
): StackTraceRow[] {
  const frames = stacktrace?.frames ?? [];
  if (frames.length === 0) return [];

  // Walk in wire order (oldest first) so "the next frame" means "the caller's
  // callee", matching the visibility rule, then reverse for display.
  const rows: StackTraceRow[] = [];
  let pendingHidden = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const next = frames[i + 1];

    if (!frameIsVisible(frame, next, includeSystemFrames)) {
      pendingHidden++;
      continue;
    }

    const previous = rows[rows.length - 1];
    if (
      previous?.kind === "frame" &&
      pendingHidden === 0 &&
      isRepeatedFrame(frame, previous.frame)
    ) {
      previous.repeats++;
      continue;
    }

    rows.push({
      kind: "frame",
      frame,
      index: i,
      repeats: 0,
      hiddenBefore: pendingHidden,
    });
    pendingHidden = 0;
  }

  // Trailing system frames still deserve a marker.
  if (pendingHidden > 0) {
    const last = rows[rows.length - 1];
    if (last?.kind === "frame") last.hiddenBefore += pendingHidden;
  }

  if (stacktrace?.framesOmitted) {
    const [from, to] = stacktrace.framesOmitted;
    rows.push({ kind: "omitted", from, to });
  }

  return newestFirst ? rows.reverse() : rows;
}

/**
 * The frame's display title, composed as
 * `filename in function at line 42:13` — the ordering from
 * `frame/defaultTitle/index.tsx`.
 */
export function formatFrameTitle(frame: FrameLike): string {
  // Java-style platforms prefer the module path over the file name.
  const location = frame.filename ?? frame.module ?? "<unknown>";
  const parts = [location];

  if (frame.function) parts.push(`in ${frame.function}`);

  // lineNo 0 is the native "no source info" convention, not line zero.
  if (frame.lineNo !== null && frame.lineNo > 0) {
    const position =
      frame.colNo !== null && frame.colNo > 0
        ? `${frame.lineNo}:${frame.colNo}`
        : String(frame.lineNo);
    parts.push(`at line ${position}`);
  }

  return parts.join(" ");
}

/** Whether a frame has anything worth expanding into. */
export function frameIsExpandable(frame: FrameLike): boolean {
  return frame.context.length > 0 || (frame.vars !== null && Object.keys(frame.vars).length > 0);
}

/** Map a filename to a tree-sitter grammar for `<code filetype>`. */
export function filetypeFor(frame: FrameLike): string | undefined {
  const name = frame.filename ?? frame.absPath ?? "";
  if (name.endsWith(".tsx")) return "tsx";
  if (name.endsWith(".ts")) return "typescript";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "javascript";
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith(".py") || name.endsWith(".pyi")) return "python";
  // Languages without a bundled grammar render unhighlighted rather than
  // failing.
  return undefined;
}
