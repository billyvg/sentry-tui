/**
 * The tape format: VHS's vocabulary, replayed into a real terminal.
 *
 * VHS renders its own headless terminal, which is why we can't use it — it
 * doesn't advertise kitty graphics, so every `<image>` in the app degrades to
 * text and the demo loses the icons. The syntax is worth keeping though: it
 * reads well, and anyone who has written a `.tape` already knows it.
 *
 * The one addition is `Wait @BNN`, which holds for exactly as long as beat
 * `BNN`'s narration audio runs. That is what keeps the picture cut to the
 * voice instead of the other way round.
 */

export interface TapeSettings {
  /** Terminal width in cells. */
  columns: number;
  /** Terminal height in cells. */
  rows: number;
  fontSize: number;
  /** Where `record.ts` writes the silent capture. */
  output: string;
}

export type TapeStep =
  /** Literal text typed into the shell, as if at the keyboard. */
  | { kind: "type"; text: string; line: number }
  /** A key chord in kitty's own notation, optionally repeated. */
  | { kind: "key"; chord: string; count: number; line: number }
  /** A fixed pause. */
  | { kind: "sleep"; ms: number; line: number }
  /** Hold for the length of a narration beat. */
  | { kind: "wait"; beat: string; line: number };

export interface Tape {
  settings: TapeSettings;
  /** Environment for the shell kitty launches. */
  env: Record<string, string>;
  steps: TapeStep[];
}

const DEFAULT_SETTINGS: TapeSettings = {
  columns: 160,
  rows: 44,
  fontSize: 18,
  output: "build/video.mp4",
};

export class TapeError extends Error {
  constructor(line: number, message: string) {
    super(`${message} (line ${line})`);
    this.name = "TapeError";
  }
}

/** `800ms`, `2s`, `1.5s`, or a bare number of milliseconds. */
export function parseDuration(raw: string, line: number): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(raw.trim());
  if (!match) throw new TapeError(line, `Not a duration: "${raw}"`);
  const value = Number(match[1]);
  return match[2] === "s" ? Math.round(value * 1000) : Math.round(value);
}

/**
 * Strip the quotes around a `Type` argument.
 *
 * Backticks are the default because the thing being typed is nearly always a
 * shell command, and a command is far more likely to contain a quote of its own
 * than a backtick.
 */
function unquote(raw: string, line: number): string {
  const text = raw.trim();
  for (const quote of ["`", '"', "'"]) {
    if (text.startsWith(quote) && text.endsWith(quote) && text.length >= 2) {
      return text.slice(1, -1);
    }
  }
  throw new TapeError(line, `Type needs a quoted argument, got: ${text}`);
}

function applySetting(settings: TapeSettings, name: string, value: string, line: number): void {
  switch (name.toLowerCase()) {
    case "columns":
      settings.columns = Number(value);
      break;
    case "rows":
      settings.rows = Number(value);
      break;
    case "fontsize":
      settings.fontSize = Number(value);
      break;
    case "output":
      settings.output = value;
      break;
    default:
      throw new TapeError(line, `Unknown setting: ${name}`);
  }
}

/**
 * Parse a tape into settings, environment and an ordered list of steps.
 *
 * Errors carry their line number: a tape is edited far more often than the
 * harness that runs it, so a typo needs to point at itself.
 */
export function parseTape(source: string): Tape {
  const settings = { ...DEFAULT_SETTINGS };
  const env: Record<string, string> = {};
  const steps: TapeStep[] = [];

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const text = (lines[i] ?? "").trim();
    if (text === "" || text.startsWith("#")) continue;

    const space = text.indexOf(" ");
    const verb = space === -1 ? text : text.slice(0, space);
    const rest = space === -1 ? "" : text.slice(space + 1).trim();

    switch (verb) {
      case "Set": {
        const [name = "", ...value] = rest.split(/\s+/);
        applySetting(settings, name, value.join(" "), line);
        break;
      }
      case "Env": {
        const at = rest.indexOf(" ");
        if (at === -1) throw new TapeError(line, `Env needs a name and a value: ${rest}`);
        env[rest.slice(0, at)] = rest.slice(at + 1).trim();
        break;
      }
      case "Type":
        steps.push({ kind: "type", text: unquote(rest, line), line });
        break;
      case "Key": {
        const [chord = "", count] = rest.split(/\s+/);
        if (!chord) throw new TapeError(line, "Key needs a chord");
        steps.push({ kind: "key", chord, count: count ? Number(count) : 1, line });
        break;
      }
      case "Sleep":
        steps.push({ kind: "sleep", ms: parseDuration(rest, line), line });
        break;
      case "Wait": {
        const beat = rest.startsWith("@") ? rest.slice(1) : rest;
        if (!/^B\d+$/.test(beat)) throw new TapeError(line, `Wait needs a beat id, got: ${rest}`);
        steps.push({ kind: "wait", beat, line });
        break;
      }
      default:
        throw new TapeError(line, `Unknown command: ${verb}`);
    }
  }

  return { settings, env, steps };
}

/**
 * Resolve every step to the millisecond offset it starts at.
 *
 * `mux.ts` needs this to lay each beat's audio at the point in the video where
 * its action actually happens, and `record.ts` uses the same walk to sleep. One
 * function so the two can't disagree about the timeline.
 *
 * @param durations Beat id to audio length in seconds, from `demo:tts`.
 * @param fallbackMs Hold for a beat with no measured audio yet.
 */
export function timeline(
  tape: Tape,
  durations: Record<string, number>,
  fallbackMs = 3000,
): Array<{ step: TapeStep; atMs: number; holdMs: number }> {
  let cursor = 0;
  return tape.steps.map((step) => {
    const atMs = cursor;
    let holdMs = 0;
    if (step.kind === "sleep") {
      holdMs = step.ms;
    } else if (step.kind === "wait") {
      const seconds = durations[step.beat];
      holdMs = seconds === undefined ? fallbackMs : Math.round(seconds * 1000);
    }
    cursor += holdMs;
    return { step, atMs, holdMs };
  });
}

/** Beat ids referenced by the tape, in the order they play. */
export function beatsInTape(tape: Tape): string[] {
  return tape.steps.flatMap((step) => (step.kind === "wait" ? [step.beat] : []));
}
