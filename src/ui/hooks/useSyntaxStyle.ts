import type { SyntaxStyle } from "@opentui/core";
import { useEffect, useState } from "react";

import { registerSyntaxParsers } from "~/assets/syntaxParsers";
import { getSyntaxStyle } from "~/core/theme";

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
  const [style, setStyle] = useState<SyntaxStyle>();

  useEffect(() => {
    let cancelled = false;
    void getSyntaxStyle().then((resolved) => {
      if (!cancelled) setStyle(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return style;
}
