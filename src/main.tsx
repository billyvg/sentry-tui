import { bootstrap, HELP_TEXT, parseArgs } from "~/app/startup";
import { runApp } from "~/ui/runApp";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

try {
  // Resolve credentials before the renderer starts, so a config problem prints
  // as plain text rather than flashing inside the alternate screen.
  const context = await bootstrap(args);
  await runApp(context);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
