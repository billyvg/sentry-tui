#!/usr/bin/env node
// Bin entry for the unscoped `sentry-tui` alias, which exists so that
// `npx sentry-tui` works. All it does is hand off to the real package.
import { main } from "@billyvg/sentry-tui/launch";

await main();
