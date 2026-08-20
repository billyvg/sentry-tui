import { formatKey, primaryKey } from "~/core/commands";
import { theme } from "~/core/theme";
import { useSpinnerFrame } from "~/ui/components/Spinner";

export type Notice =
  | { kind: "idle"; text: string }
  | { kind: "loading"; text: string }
  | { kind: "success"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string };

const NOTICE_COLOR: Record<Notice["kind"], string> = {
  idle: theme.muted,
  loading: theme.muted,
  success: theme.success,
  warning: theme.warning,
  error: theme.danger,
};

function hint(commandId: string, label?: string): string {
  const key = primaryKey(commandId);
  if (!key) return "";
  return `${formatKey(key)} ${label ?? ""}`.trim();
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
      elapsedMs !== undefined && elapsedMs >= 2000
        ? ` ${(elapsedMs / 1000).toFixed(1)}s`
        : "";
    text = `${frame} ${notice.text}${suffix}`;
  }

  return (
    <box
      style={{
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        backgroundColor: theme.panelAlt,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={NOTICE_COLOR[notice.kind]}>{text}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.muted}>
        {hints
          .map(({ command, label }) => hint(command, label))
          .filter(Boolean)
          .join(" · ")}
      </text>
    </box>
  );
}
