import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DSN,
  isCompiledBinary,
  resolveTelemetry,
  type TelemetryEnv,
} from "~/telemetry/config";

/** A released binary, pointed at a DSN of the test's own. */
const shipped = (env: TelemetryEnv = {}) =>
  resolveTelemetry({ SENTRY_TUI_DSN: "https://key@example.test/1", ...env }, { compiled: true });

describe("resolveTelemetry", () => {
  test("reports from an installed binary by default", () => {
    expect(shipped()).toMatchObject({
      dsn: "https://key@example.test/1",
      environment: "production",
      tracesSampleRate: 1,
    });
  });

  test("falls back to the project's own DSN", () => {
    expect(resolveTelemetry({}, { compiled: true })).toMatchObject({ dsn: DEFAULT_DSN });
  });

  test("stays quiet when the DSN is emptied out", () => {
    expect(shipped({ SENTRY_TUI_DSN: "" })).toBeNull();
    expect(shipped({ SENTRY_TUI_DSN: "   " })).toBeNull();
  });

  test("honours the opt-out", () => {
    expect(shipped({ SENTRY_TUI_NO_TELEMETRY: "1" })).toBeNull();
  });

  test("nothing overrides the opt-out", () => {
    expect(shipped({ SENTRY_TUI_NO_TELEMETRY: "1", SENTRY_TUI_TELEMETRY: "1" })).toBeNull();
  });

  test("reads an opt-out set to a falsy value as not set", () => {
    for (const value of ["", "0", "false", " FALSE "]) {
      expect(shipped({ SENTRY_TUI_NO_TELEMETRY: value })).not.toBeNull();
    }
  });

  test("stays quiet in CI", () => {
    expect(shipped({ CI: "true" })).toBeNull();
  });

  test("stays quiet when run from source", () => {
    expect(
      resolveTelemetry({ SENTRY_TUI_DSN: "https://key@example.test/1" }, { compiled: false }),
    ).toBeNull();
  });

  test("can be forced on in CI and from source, for testing the path itself", () => {
    expect(shipped({ CI: "true", SENTRY_TUI_TELEMETRY: "1" })).not.toBeNull();
    expect(
      resolveTelemetry(
        { SENTRY_TUI_DSN: "https://key@example.test/1", SENTRY_TUI_TELEMETRY: "1" },
        { compiled: false },
      ),
    ).toMatchObject({ environment: "development" });
  });

  test("takes a sample rate override, ignoring nonsense", () => {
    expect(shipped({ SENTRY_TUI_TRACES_SAMPLE_RATE: "0.25" })).toMatchObject({
      tracesSampleRate: 0.25,
    });
    for (const value of ["", "-1", "2", "banana"]) {
      expect(shipped({ SENTRY_TUI_TRACES_SAMPLE_RATE: value })).toMatchObject({
        tracesSampleRate: 1,
      });
    }
  });

  test("a sample rate of zero is a real choice, not a missing value", () => {
    expect(shipped({ SENTRY_TUI_TRACES_SAMPLE_RATE: "0" })).toMatchObject({
      tracesSampleRate: 0,
    });
  });
});

describe("isCompiledBinary", () => {
  test("recognises Bun's virtual filesystem", () => {
    expect(isCompiledBinary("/$bunfs/root")).toBe(true);
    expect(isCompiledBinary("/Users/someone/code/sentry-tui/src/telemetry")).toBe(false);
  });
});
