import { KeyHint } from "~/ui/components/KeyHint";

/**
 * Prefix shared by full-width screen searches and compact dropdown filters.
 *
 * The input surfaces stay separate because their layout and focus behavior
 * differ, while the `/` remains the same findable hotkey in both contexts.
 */
export function SearchInputHint() {
  return (
    <>
      <KeyHint command="sentry.nav.search" />
      <text> </text>
    </>
  );
}
