// Runs detached, while the app the user actually asked for is on screen.
//
// Nothing here may write to stdout or stderr: those file descriptors belong to
// a TUI holding the alternate screen, and a stray line would corrupt it. The
// launcher spawns this with stdio ignored; failures go to a log file instead,
// so a persistently failing update leaves evidence without ever being seen.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { cacheRoot, downloadIfNewer } from "./update.mjs";

const [packageName, localVersion] = process.argv.slice(2);

/** Last few update attempts, for when someone asks why they are not current. */
function note(message) {
  try {
    mkdirSync(cacheRoot(), { recursive: true });
    appendFileSync(join(cacheRoot(), "update.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log we cannot write is not worth crashing a background process over.
  }
}

if (!packageName) process.exit(0);

try {
  const result = await downloadIfNewer({ packageName, localVersion: localVersion || undefined });
  if (result.status === "updated") note(`downloaded ${result.version}`);
} catch (error) {
  note(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0); // Never a non-zero exit: nothing is waiting on this.
}
