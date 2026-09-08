import { useEffect, useState } from "react";
import type { Hunk } from "@/lib/diff/render";
import type { HunkHighlight } from "@/lib/syntax/highlight";

let highlighterModule: Promise<typeof import("@/lib/syntax/highlight")> | undefined;

function highlight(path: string, hunk: Hunk) {
  highlighterModule ??= import("@/lib/syntax/highlight");
  return highlighterModule
    .then(({ highlightHunk }) => highlightHunk(path, hunk))
    .catch((error) => {
      console.warn(`Could not load syntax highlighting for ${path}`, error);
      return undefined;
    });
}

export function useSyntaxHighlighting(path: string, hunk: Hunk) {
  const [result, setResult] = useState<{ hunk: Hunk; highlight?: HunkHighlight }>();

  useEffect(() => {
    let active = true;
    void highlight(path, hunk).then((highlight) => {
      if (active) setResult({ hunk, highlight });
    });
    return () => {
      active = false;
    };
  }, [path, hunk]);

  return result?.hunk === hunk ? result.highlight : undefined;
}
