/**
 * Whether to report, and what to report as.
 *
 * Kept apart from `index.ts` so the decision is a pure function of the
 * environment: no SDK, no globals, testable as a table.
 */

import { host } from "../../release.json";

/**
 * Where sentry-tui's own errors go.
 *
 * A DSN is a public identifier by design — it says where to deliver, and
 * grants nothing — so it lives in the source rather than in the environment,
 * the way it must for a binary that has to report from a stranger's terminal.
 * `SENTRY_TUI_DSN` points it somewhere else; empty turns reporting off.
 *
 * Read deliberately instead of letting the SDK pick up the ambient `SENTRY_DSN`:
 * anyone developing against their own Sentry project has that exported, and
 * their project should not start receiving sentry-tui's crashes.
 */
export const DEFAULT_DSN =
  "https://1ce8f37a1435bc3dc3ff6dbe7f7a72d6@o1.ingest.us.sentry.io/4511949151469569";

/** `sentry-tui@0.2.0` — the release these events belong to. */
export const RELEASE = `sentry-tui@${host}`;

/**
 * True when running from `bun build --compile` output rather than source.
 *
 * The compiled bundle is served from Bun's virtual filesystem, which is the
 * only signal available before anything else has been resolved.
 */
export function isCompiledBinary(dir: string = import.meta.dir): boolean {
  return dir.startsWith("/$bunfs");
}

/** Environment variables this module reads. Narrowed for testability. */
export interface TelemetryEnv {
  SENTRY_TUI_DSN?: string | undefined;
  SENTRY_TUI_NO_TELEMETRY?: string | undefined;
  SENTRY_TUI_TELEMETRY?: string | undefined;
  SENTRY_TUI_TRACES_SAMPLE_RATE?: string | undefined;
  CI?: string | undefined;
}

export interface TelemetrySettings {
  dsn: string;
  environment: "production" | "development";
  release: string;
  tracesSampleRate: number;
}

/** An env var counts as set unless it is empty, `0`, or `false`. */
function flag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

const DEFAULT_TRACES_SAMPLE_RATE = 1;

/** Parse the sample-rate override, ignoring anything that isn't a 0–1 number. */
function tracesSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_TRACES_SAMPLE_RATE;
  return parsed;
}

/**
 * Resolve whether to report, and with what settings. `null` means stay quiet.
 *
 * Reporting is on by default for an installed binary and off everywhere it
 * would be noise or a surprise: no DSN, an explicit opt-out, CI, or a dev
 * running from source. The last two are reversible with `SENTRY_TUI_TELEMETRY=1`
 * when you want to exercise the reporting path itself; nothing reverses
 * `SENTRY_TUI_NO_TELEMETRY`.
 */
export function resolveTelemetry(
  env: TelemetryEnv,
  { compiled }: { compiled: boolean },
): TelemetrySettings | null {
  if (flag(env.SENTRY_TUI_NO_TELEMETRY)) return null;

  const dsn = (env.SENTRY_TUI_DSN ?? DEFAULT_DSN).trim();
  if (dsn === "") return null;

  const forced = flag(env.SENTRY_TUI_TELEMETRY);
  if (!forced && flag(env.CI)) return null;
  if (!forced && !compiled) return null;

  return {
    dsn,
    environment: compiled ? "production" : "development",
    release: RELEASE,
    tracesSampleRate: tracesSampleRate(env.SENTRY_TUI_TRACES_SAMPLE_RATE),
  };
}
