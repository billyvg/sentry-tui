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

/** Border and padding on both sides, i.e. `width` minus usable content. */
export const HELP_CHROME = 4;
export const HELP_WIDTH = 60;
/**
 * Wide enough for the longest key list in the catalog — `1, 2, 3, 4, 5, 6`.
 * A command whose keys overflow this gets an ellipsis, which advertises a chord
 * that doesn't exist; `commands.test.ts` holds the catalog to the column.
 */
export const HELP_KEY_COLUMN = 17;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  // Rows are generated from the catalog, so an unbound command simply has no
  // row rather than advertising a dead key.
  const rows = SECTIONS.flatMap(({ category, title }) => {
    const commands = COMMANDS.filter((c) => c.category === category && c.defaultKeys.length > 0);
    return commands.length ? [{ heading: title }, ...commands] : [];
  });

  // Every heading but the first also prints a blank line above itself, so the
  // row count alone understates the content and clips the last command off the
  // bottom. `ModalFrame` clamps this to the terminal, so overshooting is safe
  // and undershooting is not.
  const spacers = Math.max(0, SECTIONS.length - 1);
  const height = rows.length + spacers + HELP_CHROME + 1;

  return (
    <ModalFrame title=" Keyboard shortcuts " width={HELP_WIDTH} height={height} onClose={onClose}>
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
              <span fg={theme.text}>{padText(keys, HELP_KEY_COLUMN)}</span>
              <span fg={theme.muted}>{row.description ?? row.title}</span>
            </text>
          );
        })}
      </scrollbox>
      <text fg={theme.muted}>esc to close</text>
    </ModalFrame>
  );
}
