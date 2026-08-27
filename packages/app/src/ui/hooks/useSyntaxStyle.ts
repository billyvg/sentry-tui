import type { SyntaxStyle } from "@opentui/core";
import { useEffect, useState } from "react";

import { registerSyntaxParsers } from "~/assets/syntaxParsers";
import { getSyntaxStyle } from "~/core/theme";
import { useTheme } from "~/ui/theme";

// Registration must precede the first CodeRenderable: OpenTUI snapshots its
// default parsers when the shared Tree-sitter client initializes.
registerSyntaxParsers();

/**
 * Resolve the shared syntax style.
 *
 * Returns undefined on the first render, so callers fall back to plain text —
 * highlighting is an enhancement and must never gate showing the source line.
 */
export function useSyntaxStyle(): SyntaxStyle | undefined {
  const theme = useTheme();
  const [style, setStyle] = useState<SyntaxStyle>();

  useEffect(() => {
    let cancelled = false;
    setStyle(undefined);
    void getSyntaxStyle(theme)
      .then((resolved) => {
        if (!cancelled) setStyle(resolved);
      })
      .catch(() => {
        if (!cancelled) setStyle(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  return style;
}
