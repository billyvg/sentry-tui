import { primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { KeyHint } from "~/ui/components/KeyHint";
import { SentryLogo } from "~/ui/components/NavIcon";
import { useSpinnerFrame } from "~/ui/components/Spinner";
import { useImageSupport } from "~/ui/hooks/useImageSupport";

export type Notice =
  | { kind: "idle"; text: string }
  | { kind: "loading"; text: string }
  | { kind: "success"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string }
  /** Something about what you're looking at changed — not a pass or a fail. */
  | { kind: "highlight"; text: string };

const NOTICE_COLOR: Record<Notice["kind"], string> = {
  idle: theme.muted,
  loading: theme.muted,
  success: theme.success,
  warning: theme.warning,
  error: theme.danger,
  highlight: theme.highlight,
};

/** Rendered hint item: parenthesised key + label in muted. */
function HintItem({ commandId, label }: { commandId: string; label?: string }) {
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
 * The single global activity slot. Any in-flight request must be visible here —
 * a silent multi-second pause is indistinguishable from a hang.
 */
export function StatusBar({
  notice,
  hints,
  elapsedMs,
}: {
  notice: Notice;
  hints: ReadonlyArray<{ command: string; label?: string }>;
  /** Wall-clock elapsed for the current load, so "slow" reads differently to "hung". */
  elapsedMs?: number;
}) {
  const loading = notice.kind === "loading";
  const frame = useSpinnerFrame(loading);

  let text = notice.text;
  if (loading) {
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
      <text fg={NOTICE_COLOR[notice.kind]}>{text}</text>
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
