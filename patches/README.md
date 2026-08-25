# Dependency patches

`@opentui/core@0.5.4.patch` removes OpenTUI's unconditional Zig parser and its
static Bun asset imports. sentry-tui only highlights source from Sentry stack
frames, so shipping the Zig WASM adds binary weight without a reachable use.

OpenTUI does not currently expose an API to replace its default parser set.
Upstream issue [anomalyco/opentui#1434](https://github.com/anomalyco/opentui/issues/1434)
tracks adding one; remove this patch once sentry-tui can configure the defaults
through a supported API.
