/**
 * Driving a real Kitty window over its remote-control socket.
 *
 * Kitty is the renderer because it speaks the kitty graphics protocol, which is
 * what `useImageSupport` requires before the app will draw a single icon. It
 * also ships `@ send-key` and `@ send-text`, so a scripted demo needs no
 * synthetic keyboard events and no Accessibility permission to type.
 */

import { rm } from "node:fs/promises";

/** How long to wait for kitty to create its control socket before giving up. */
const SOCKET_TIMEOUT_MS = 10_000;
const SOCKET_POLL_MS = 100;
/** How long a SIGTERM gets before the harness stops asking nicely. */
const GRACEFUL_EXIT_MS = 3000;

export interface KittyOptions {
  socket: string;
  columns: number;
  rows: number;
  fontSize: number;
  /** Working directory for the shell kitty launches. */
  cwd: string;
  /** Extra environment for that shell. */
  env: Record<string, string>;
}

export class KittySession {
  private constructor(
    private readonly socket: string,
    private readonly process: Bun.Subprocess,
  ) {}

  /**
   * Launch a dedicated kitty window and wait until it answers on its socket.
   *
   * The shell is `zsh -f` on purpose: a demo should not be showing anyone's
   * prompt theme, aliases or shell greeting, and `PS1` through kitty's own
   * `env` then gives a clean single-glyph prompt. Kitty's shell integration is
   * off for the same reason — it would redraw a prompt of its own.
   *
   * `interactivecomments` is the one option added back, because the outro types
   * a `#` line and zsh otherwise tries to execute it.
   *
   * macOS runs the shell under `login` regardless, which prints a "Last login"
   * banner that no shell flag suppresses. {@link clearScreen} wipes it before
   * the capture starts.
   */
  static async launch(options: KittyOptions): Promise<KittySession> {
    await rm(options.socket, { force: true });

    const prompt = options.env["PS1"]?.trim() ?? "❯";
    // No trailing space here: kitty strips whitespace off an `-o env=` value, so
    // it never reaches the shell and every command comes out as `❯command`.
    // {@link setPrompt} puts it back from inside the shell instead.
    const env = { ...options.env, PS1: prompt, PROMPT: prompt };
    const args = [
      "kitty",
      "--listen-on",
      `unix:${options.socket}`,
      "--directory",
      options.cwd,
      "--title",
      "sentry-tui demo",
      "-o",
      "allow_remote_control=yes",
      "-o",
      "remember_window_size=no",
      "-o",
      `initial_window_width=${options.columns}c`,
      "-o",
      `initial_window_height=${options.rows}c`,
      "-o",
      `font_size=${options.fontSize}`,
      "-o",
      "confirm_os_window_close=0",
      // A scrollbar or a bell mid-take would be in the video forever.
      "-o",
      "enable_audio_bell=no",
      "-o",
      "shell_integration=disabled",
      // No title bar: it is where macOS parks the stop-recording control during
      // a window capture, and a terminal demo has no use for window chrome.
      "-o",
      "hide_window_decorations=yes",
      ...Object.entries(env).flatMap(([key, value]) => ["-o", `env=${key}=${value}`]),
      "/bin/zsh",
      "-f",
      // The outro types a `#` comment, and zsh runs `#` as a command unless
      // this is set — "command not found: #", on camera, at the sign-off.
      "-o",
      "interactivecomments",
    ];

    const process = Bun.spawn(args, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    const session = new KittySession(options.socket, process);
    await session.waitForSocket();
    return session;
  }

  private async waitForSocket(): Promise<void> {
    const deadline = Date.now() + SOCKET_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const probe = Bun.spawn(["kitty", "@", "--to", `unix:${this.socket}`, "ls"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await probe.exited) === 0) return;
      await Bun.sleep(SOCKET_POLL_MS);
    }
    throw new Error(
      `kitty never answered on ${this.socket}. Is kitty installed and able to open a window?`,
    );
  }

  private async remote(...args: string[]): Promise<void> {
    const proc = Bun.spawn(["kitty", "@", "--to", `unix:${this.socket}`, ...args], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await proc.exited) !== 0) {
      throw new Error(`kitty @ ${args[0]} failed: ${await new Response(proc.stderr).text()}`);
    }
  }

  /**
   * Type literal text.
   *
   * `--` stops kitty parsing a leading dash in the payload as one of its own
   * flags, which a tape line like `Type "--org sentry"` would otherwise hit.
   */
  async type(text: string): Promise<void> {
    await this.remote("send-text", "--match", "all", "--", text);
  }

  /**
   * Send a key chord in kitty's notation (`enter`, `ctrl+k`, `shift+g`).
   *
   * Kitty documents that `send-key` reports success even when nothing was
   * delivered — it cannot know whether the program's keyboard mode accepted the
   * key. So a tape that silently does nothing is a real failure mode, and the
   * only true test of a recording is watching it.
   */
  async key(chord: string, count = 1): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.remote("send-key", "--match", "all", chord);
    }
  }

  /**
   * Wipe the screen and scrollback.
   *
   * macOS starts the shell under `login`, which prints a "Last login" banner no
   * shell flag suppresses — so the demo clears it away rather than trying to
   * prevent it.
   */
  /**
   * Set the prompt from inside the shell, where a trailing space survives.
   *
   * kitty trims its `-o env=` values, so a prompt passed that way loses the
   * space after the glyph and the demo types `❯npx sentry-tui`. Assigning it as
   * a shell parameter is the only way to keep it. Call this before
   * {@link clearScreen}, and the line that does it is never on camera.
   */
  async setPrompt(prompt: string): Promise<void> {
    if (prompt.includes("'")) throw new Error(`Prompt cannot contain a quote: ${prompt}`);
    await this.type(`PS1='${prompt} '`);
    await this.key("enter");
  }

  async clearScreen(): Promise<void> {
    await this.type("clear\r");
  }

  /**
   * What is currently on screen.
   *
   * The one way to check a keystroke actually did something: `send-key` reports
   * success unconditionally, so asserting on the resulting screen is the only
   * feedback the harness can get.
   */
  async screenText(): Promise<string> {
    const proc = Bun.spawn(
      ["kitty", "@", "--to", `unix:${this.socket}`, "get-text", "--match", "all"],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  }

  /** The CGWindowID, for `screencapture -l`. */
  async platformWindowId(): Promise<number | null> {
    const proc = Bun.spawn(["kitty", "@", "--to", `unix:${this.socket}`, "ls"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const raw = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0 || !raw.trim()) return null;
    const payload = JSON.parse(raw) as Array<{ platform_window_id?: number }>;
    return payload[0]?.platform_window_id ?? null;
  }

  /**
   * Close the window and make sure the process is actually gone.
   *
   * Both escalations are load-bearing. Waiting on `exited` unconditionally
   * hangs the harness after an otherwise successful take, and SIGTERM alone
   * leaves the process alive with its window shut — an invisible kitty per run,
   * which is how you end up with a dozen of them and no idea where from.
   */
  async close(): Promise<void> {
    try {
      await this.remote("close-window", "--match", "all");
    } catch {
      // The window may already be gone — that's the outcome we wanted anyway.
    }

    this.process.kill();
    const exited = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(GRACEFUL_EXIT_MS).then(() => false),
    ]);

    if (!exited) {
      this.process.kill("SIGKILL");
      await Promise.race([this.process.exited, Bun.sleep(GRACEFUL_EXIT_MS)]);
    }

    await rm(this.socket, { force: true });
  }
}
