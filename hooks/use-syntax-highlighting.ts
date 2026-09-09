import { useEffect, useState } from "react";
import type { Hunk } from "@/lib/diff/render";
import type { HunkHighlight } from "@/lib/syntax/highlight";

let highlighterModule: Promise<typeof import("@/lib/syntax/highlight")> | undefined;
const contentCache = new Map<string, Promise<string>>();

type ReadContent = (object: string) => Promise<string>;

function readObject(object: string | null, readContent: ReadContent) {
  if (!object) return Promise.resolve("");
  let pending = contentCache.get(object);
  if (!pending) {
    pending = readContent(object).catch((error) => {
      contentCache.delete(object);
      throw error;
    });
    contentCache.set(object, pending);
  }
  return pending;
}

async function highlight(
  path: string,
  hunk: Hunk,
  oldObject: string | null,
  newObject: string | null,
  readContent: ReadContent,
) {
  highlighterModule ??= import("@/lib/syntax/highlight");
  const module = await highlighterModule;
  if (!module.languageForPath(path)) return undefined;
  const [old, next] = await Promise.all([
    readObject(oldObject, readContent),
    readObject(newObject, readContent),
  ]);
  return module.highlightHunk(path, hunk, {
    old,
    new: next,
    key: `${oldObject || "empty"}:${newObject || "empty"}`,
  });
}

export function useSyntaxHighlighting(
  path: string,
  hunk: Hunk,
  oldObject: string | null,
  newObject: string | null,
  readContent: ReadContent,
) {
  const sourceKey = `${oldObject || "empty"}:${newObject || "empty"}`;
  const [result, setResult] = useState<{
    hunk: Hunk;
    sourceKey: string;
    highlight?: HunkHighlight;
  }>();

  useEffect(() => {
    let active = true;
    void highlight(path, hunk, oldObject, newObject, readContent)
      .then((highlight) => {
        if (active) setResult({ hunk, sourceKey, highlight });
      })
      .catch((error) => {
        console.warn(`Could not load syntax highlighting for ${path}`, error);
        if (active) setResult({ hunk, sourceKey });
      });
    return () => {
      active = false;
    };
  }, [path, hunk, oldObject, newObject, sourceKey, readContent]);

  return result?.hunk === hunk && result.sourceKey === sourceKey ? result.highlight : undefined;
}
