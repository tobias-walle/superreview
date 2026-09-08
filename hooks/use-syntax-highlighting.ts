import { useEffect, useState } from "react";
import type { Hunk } from "@/lib/diff/render";
import { highlightHunk, type HunkHighlight } from "@/lib/syntax/highlight";

export function useSyntaxHighlighting(path: string, hunk: Hunk) {
  const [result, setResult] = useState<{ hunk: Hunk; highlight?: HunkHighlight }>();

  useEffect(() => {
    let active = true;
    void highlightHunk(path, hunk).then((highlight) => {
      if (active) setResult({ hunk, highlight });
    });
    return () => {
      active = false;
    };
  }, [path, hunk]);

  return result?.hunk === hunk ? result.highlight : undefined;
}
