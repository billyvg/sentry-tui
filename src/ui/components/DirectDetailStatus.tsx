import { errorOf, type AsyncStatus } from "~/core/async";
import { useTheme } from "~/ui/theme";

/** Loading or failure state for a detail opened by identifier from a URL. */
export function DirectDetailStatus({
  status,
  noun,
  width,
  height,
}: {
  status: AsyncStatus<unknown>;
  noun: string;
  width: number;
  height: number;
}) {
  const theme = useTheme();
  const error = errorOf(status);
  return (
    <box style={{ flexDirection: "column", width, height, paddingLeft: 1 }}>
      <text fg={error ? theme.danger : theme.muted}>
        {error ? `Failed to load ${noun}: ${error.message}` : `Loading ${noun}…`}
      </text>
    </box>
  );
}
