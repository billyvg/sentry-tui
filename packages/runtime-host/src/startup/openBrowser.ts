import { countMetric } from "@sentry-tui/runtime-host/telemetry/index";

/** Launch a URL with the platform browser without borrowing the TUI's streams. */
export async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    const exitCode = await child.exited;
    if (exitCode === 0) return true;
    countMetric("nav.browser.open_failed", { platform: process.platform, outcome: "exit" });
    return false;
  } catch {
    countMetric("nav.browser.open_failed", { platform: process.platform, outcome: "spawn" });
    return false;
  }
}
