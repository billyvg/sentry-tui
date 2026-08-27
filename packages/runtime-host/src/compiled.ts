import { configureOpenTuiRuntime } from "@sentry-tui/runtime-host/opentui/openTuiRuntime";

// OpenTUI snapshots this environment variable as its module initializes, so
// the application has to load only after the embedded worker path is set.
configureOpenTuiRuntime();

if (process.env.SENTRY_TUI_VERIFY_SYNTAX === "1") {
  const { verifySyntaxRuntime } = await import("@sentry-tui/runtime-host/opentui/syntaxProbe");
  await verifySyntaxRuntime();
  process.stdout.write("syntax parsers verified\n");
} else if (process.env.SENTRY_TUI_VERIFY_PAYLOAD) {
  const { loadAppPayload } = await import("@sentry-tui/runtime-host/ui/loadPayload");
  const loaded = await loadAppPayload(process.env.SENTRY_TUI_VERIFY_PAYLOAD);
  process.stdout.write(`app payload ${loaded.metadata.version} verified\n`);
} else {
  await import("@sentry-tui/runtime-host/main");
}
