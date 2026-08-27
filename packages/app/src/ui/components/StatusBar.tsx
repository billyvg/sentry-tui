import { primaryKey } from "~/core/commands";
import type { Theme } from "~/core/theme";
import { useTheme } from "~/ui/theme";
import { KeyHint } from "~/ui/components/KeyHint";
import { SentryLogo } from "~/ui/components/NavIcon";
import { useSpinnerFrame } from "~/ui/components/Spinner";
import { useImageSupport } from "~/ui/hooks/useImageSupport";
import { BOLD } from "~/ui/lib/attributes";

/**
 * What a notice is announcing. The kind is the event, not the styling — the
 * status bar decides how to paint it.
 *
 * Notice text is written in lower case throughout: the bar is the app talking
 * under its breath, and a capital letter in the corner of the screen reads as
 * a heading. Identifiers keep their own casing — `PUMP-STATION-1` is data, not
 * prose.
 */
export type Notice =
  | { kind: "idle"; text: string }
  | { kind: "loading"; text: string }
  | { kind: "success"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string }
  /** Something about what you're looking at changed — not a pass or a fail. */
  | { kind: "info"; text: string };

/**
 * Notices speak in the app's own voice — Sentry pink — with one exception.
 *
 * An error has to break the pattern to register at all: if failure wore the
 * same color as every routine "loading issues…", the only thing distinguishing
 * it would be reading it, which is precisely what nobody does with a status bar.
 */
function noticeColor(kind: Notice["kind"], theme: Theme): string {
  return kind === "error" ? theme.danger : theme.highlight;
}

/** Rendered hint item: parenthesised key + label in muted. */
function HintItem({ commandId, label }: { commandId: string; label?: string }) {
  const theme = useTheme();
  if (!primaryKey(commandId)) return null;
  return (
    <>
      <KeyHint command={commandId} />
      <text> </text>
      {label ? <text fg={theme.muted}>{label}</text> : null}
    </>
  );
}

/**
 * The offer to restart into a build that is already downloaded.
 *
 * Capitalised where every notice beside it is lower case, and bold where none
 * of them are: this is the one thing in the bar that is not the app narrating
 * itself, and it has to survive being ignored for an hour without ever being
 * mistaken for another "loading issues…".
 */
function UpdatePill({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }} onMouseDown={onPress}>
      <text fg={theme.highlight} attributes={BOLD}>
        Update
      </text>
      <text fg={theme.subText}>{" · "}</text>
    </box>
  );
}

/**
 * The single global activity slot. Any in-flight request must be visible here —
 * a silent multi-second pause is indistinguishable from a hang.
 */
export function StatusBar({
  notice,
  hints,
  since,
  onUpdate,
}: {
  notice: Notice;
  hints: ReadonlyArray<{ command: string; label?: string }>;
  /** When the current load started, so "slow" reads differently to "hung". */
  since?: number;
  /** Present only when a newer build is downloaded and ready to restart into. */
  onUpdate?: () => void;
}) {
  const theme = useTheme();
  const loading = notice.kind === "loading";
  const frame = useSpinnerFrame(loading);

  let text = notice.text;
  if (loading) {
    // The elapsed count rides the spinner's tick rather than a timer of its
    // own: the bar is already re-rendering at 80ms, and it is the only thing
    // in the app that needs to. A screen that ticked instead would re-render
    // its whole table ten times a second to move one decimal place.
    const elapsedMs = since === undefined ? undefined : Date.now() - since;
    // Only surface elapsed time once the wait is long enough to worry about.
    const suffix =
      elapsedMs !== undefined && elapsedMs >= 2000 ? ` ${(elapsedMs / 1000).toFixed(1)}s` : "";
    text = `${frame} ${notice.text}${suffix}`;
  }

  return (
    <box
      style={{
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        backgroundColor: theme.panel,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {onUpdate ? <UpdatePill onPress={onUpdate} /> : null}
      <text fg={noticeColor(notice.kind, theme)}>{text}</text>
      <box style={{ flexGrow: 1 }} />
      {hints.map(({ command, label }, i) => {
        const key = primaryKey(command);
        if (!key) return null;
        return (
          <box key={command} style={{ flexDirection: "row" }}>
            {i > 0 ? <text fg={theme.subText}>{" · "}</text> : null}
            <HintItem commandId={command} label={label} />
          </box>
        );
      })}
      <SentryBadge />
    </box>
  );
}

/** Renders the Sentry logo in the bottom-right corner when the terminal supports images. */
function SentryBadge() {
  const { supportsHighRes } = useImageSupport();
  if (!supportsHighRes) return null;

  return (
    <box style={{ marginLeft: 1 }}>
      <SentryLogo />
    </box>
  );
}
