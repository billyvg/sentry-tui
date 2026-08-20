import { COMMANDS, formatKey, type CommandCategory } from "~/core/commands";
import { theme } from "~/core/theme";
import { padText } from "~/lib/text";
import { ModalFrame } from "~/ui/components/ModalFrame";

const SECTIONS: Array<{ category: CommandCategory; title: string }> = [
  { category: "nav", title: "Navigation" },
  { category: "issue", title: "Issue actions" },
  { category: "view", title: "View / Filters" },
  { category: "app", title: "Application" },
];

const KEY_COLUMN = 14;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  // Rows are generated from the catalog, so an unbound command simply has no
  // row rather than advertising a dead key.
  const rows = SECTIONS.flatMap(({ category, title }) => {
    const commands = COMMANDS.filter((c) => c.category === category && c.defaultKeys.length > 0);
    return commands.length ? [{ heading: title }, ...commands] : [];
  });

  const height = Math.min(rows.length + 5, 30);

  return (
    <ModalFrame title=" Keyboard shortcuts " width={56} height={height} onClose={onClose}>
      <scrollbox style={{ flexGrow: 1 }}>
        {rows.map((row, i) => {
          if ("heading" in row) {
            return (
              <text key={`h-${row.heading}`} fg={theme.accent}>
                {i === 0 ? "" : "\n"}
                {row.heading}
              </text>
            );
          }
          const keys = row.defaultKeys.map(formatKey).join(", ");
          return (
            <text key={row.id}>
              <span fg={theme.text}>{padText(keys, KEY_COLUMN)}</span>
              <span fg={theme.muted}>{row.description ?? row.title}</span>
            </text>
          );
        })}
      </scrollbox>
      <text fg={theme.muted}>esc to close</text>
    </ModalFrame>
  );
}
