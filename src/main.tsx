import { runLogin, runLogout, runStatus } from "~/app/login";
import { bootstrap, HELP_TEXT, migrateLegacyCredentials, parseArgs } from "~/app/startup";
import { runApp } from "~/ui/runApp";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

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
      // Resolve credentials before the renderer starts, so a config problem
      // prints as plain text rather than flashing inside the alternate screen.
      const context = await bootstrap(args);
      await runApp(context);
      break;
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
