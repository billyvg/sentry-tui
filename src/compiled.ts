import { configureOpenTuiRuntime } from "~/assets/openTuiRuntime";

// OpenTUI snapshots this environment variable as its module initializes, so
// the application has to load only after the embedded worker path is set.
configureOpenTuiRuntime();

if (process.env.SENTRY_TUI_VERIFY_SYNTAX === "1") {
  const { verifySyntaxRuntime } = await import("~/assets/syntaxProbe");
  await verifySyntaxRuntime();
  process.stdout.write("syntax parsers verified\n");
} else {
  await import("~/main");
}
