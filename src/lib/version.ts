// The repo's manifest is the single source of truth for the version — the
// released binaries, the npm packages, and the Homebrew formula all derive
// theirs from it. Importing it statically also means `bun build --compile`
// inlines the value, so a compiled binary reports the version it was cut at
// rather than reading a file that isn't shipped beside it.
import { version } from "../../package.json";

/** The running build's version, e.g. `0.2.0`. */
export const APP_VERSION: string = version;

/**
 * The one rendering of the version: `sentry-tui --version`, `sentry-tui
 * status`, and the command palette's footer all print this, so a version in a
 * bug report is recognisable as the same string wherever it was copied from.
 */
export const VERSION_LABEL = `v${APP_VERSION}`;
