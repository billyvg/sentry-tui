#!/usr/bin/env bun
// The shebang is load-bearing for the `bin` entry this package declares. Run
// `npx sentry-tui` from inside a checkout and npm resolves the name to this
// package rather than the published one, then execs this file directly — with
// no shebang the shell parses TSX and reports `import: command not found`.
// Released binaries never take this path; the compiled build has its own entry.
import { runLogin, runLogout, runStatus } from "~/app/login";
import { bootstrap, HELP_TEXT, migrateLegacyCredentials, parseArgs } from "~/app/startup";
import { VERSION_LABEL } from "~/lib/version";
import {
  beginAppRun,
  initTelemetry,
  installCrashHandlers,
  reportError,
  shutdownTelemetry,
} from "~/telemetry/index";
import { runApp } from "~/ui/runApp";

const args = parseArgs(process.argv.slice(2));

// Both answer from the binary alone: ahead of telemetry, credentials, and any
// other startup step that could fail before the question gets answered.
if (args.version) {
  process.stdout.write(`sentry-tui ${VERSION_LABEL}\n`);
  process.exit(0);
}

if (args.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

// Ahead of everything that can fail, so a crash in startup is still reported.
// A no-op unless this is a released binary with telemetry left switched on —
// see `src/telemetry/config.ts`.
await initTelemetry();
installCrashHandlers();

try {
  await migrateLegacyCredentials();

  switch (args.command) {
    case "login":
      await runLogin({ noBrowser: args.noBrowser });
      break;
    case "logout":
      await runLogout();
      break;
    case "status":
      await runStatus();
      break;
    case "run": {
      // From here on this is a session someone is sitting in front of.
      beginAppRun();
      // Resolve credentials before the renderer starts, so a config problem
      // prints as plain text rather than flashing inside the alternate screen.
      const context = await bootstrap(args);
      await runApp(context);
      break;
    }
  }
  // Only the short commands. `runApp` returns the moment it has handed the
  // screen to the renderer — the process stays alive because the renderer
  // holds it, and quitting goes through `runApp`'s own shutdown. Closing the
  // session here would file every run as over seconds after it started.
  if (args.command !== "run") await shutdownTelemetry();
} catch (error) {
  reportError(error, { source: "startup" });
  await shutdownTelemetry();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
