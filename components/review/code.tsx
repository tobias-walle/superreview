import type { CSSProperties } from "react";
import { Gutter, lineSelected } from "./comments";
import { useComments } from "@/hooks/use-comments";
import type { Part, DiffLine } from "@/lib/diff/render";
import type { HunkHighlight, SyntaxToken } from "@/lib/syntax/highlight";

// Shiki follows TextMate's font-style bit flags.
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const FONT_STYLE_STRIKETHROUGH = 8;

type SyntaxProperties = CSSProperties & {
  "--syntax-mocha": string;
  "--syntax-latte": string;
};

function syntaxStyle(token: SyntaxToken): SyntaxProperties {
  const decorations = [
    token.fontStyle & FONT_STYLE_UNDERLINE ? "underline" : "",
    token.fontStyle & FONT_STYLE_STRIKETHROUGH ? "line-through" : "",
  ].filter(Boolean);
  return {
    "--syntax-mocha": token.mocha,
    "--syntax-latte": token.latte,
    fontStyle: token.fontStyle & FONT_STYLE_ITALIC ? "italic" : undefined,
    fontWeight: token.fontStyle & FONT_STYLE_BOLD ? "bold" : undefined,
    textDecoration: decorations.join(" ") || undefined,
  };
}
export function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop() || "";
  return (
    <span className={`file-icon ${ext}`}>
      {ext === "ts"
        ? "TS"
        : ext === "tsx"
          ? "TS"
          : ext === "json"
            ? "{}"
            : ext === "css"
              ? "#"
              : "↓"}
    </span>
  );
}
export function Highlight({
  parts,
  words,
  syntax = [],
}: {
  parts: Part[];
  words: boolean;
  syntax?: SyntaxToken[];
}) {
  const text = parts.map((p) => p.text).join("");
  const syntaxRanges = syntax.reduce<Array<{ start: number; end: number; token: SyntaxToken }>>(
    (ranges, token) => {
      const start = ranges.at(-1)?.end || 0;
      ranges.push({ start, end: start + token.text.length, token });
      return ranges;
    },
    [],
  );
  const offsets = parts.reduce(
    (values, part) => [...values, values.at(-1)! + part.text.length],
    [0],
  );
  return (
    <>
      {parts.map((part, i) => {
        const start = offsets[i];
        const end = offsets[i + 1];
        const points = [
          start,
          ...syntaxRanges
            .flatMap((range) => [range.start, range.end])
            .filter((offset) => offset > start && offset < end),
          end,
        ].sort((a, b) => a - b);
        return (
          <span key={i} className={words && part.changed ? "word-change" : ""}>
            {points.slice(0, -1).map((x, j) => {
              const range = syntaxRanges.find((token) => token.start <= x && token.end > x);
              return (
                <span
                  key={j}
                  className={range ? "syntax-token" : undefined}
                  style={range ? syntaxStyle(range.token) : undefined}
                >
                  {text.slice(x, points[j + 1])}
                </span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}
export function Cell({
  line,
  unified,
  newSideOnly = false,
  words,
  file,
  hunk,
  side,
  highlight,
  interactive = true,
}: {
  line?: DiffLine;
  unified?: boolean;
  newSideOnly?: boolean;
  words: boolean;
  file: number;
  hunk: number;
  side: "old" | "new";
  highlight?: HunkHighlight;
  interactive?: boolean;
}) {
  const c = useComments();
  const actualSide = unified ? (line?.kind === "del" ? "old" : "new") : side;
  const selected =
    interactive &&
    (lineSelected(line, file, hunk, actualSide, c) ||
      (unified && line?.kind === "context" && lineSelected(line, file, hunk, "old", c)));
  const lineNumber = (targetSide: "old" | "new") =>
    targetSide === "old" ? line?.oldNo : line?.newNo;
  const gutter = (targetSide: "old" | "new") =>
    line && interactive && lineNumber(targetSide) !== undefined ? (
      <Gutter line={line} side={targetSide} file={file} hunk={hunk} />
    ) : (
      <span className="line-no">{lineNumber(targetSide)}</span>
    );
  return (
    <div
      className={`code-cell ${line?.kind || "empty"} ${selected ? "comment-selected" : ""}`}
      data-comment-pos={
        line && interactive ? `${c.meta[file]?.fingerprint}:${hunk}:${line.sourceIndex}` : undefined
      }
    >
      {unified ? (
        <>
          {!newSideOnly && gutter("old")}
          {gutter("new")}
        </>
      ) : (
        gutter(side)
      )}
      <span className="line-sign">
        {line?.kind === "add" ? "+" : line?.kind === "del" ? "−" : " "}
      </span>
      <code className="source">
        {line && (
          <Highlight
            parts={line.parts}
            words={words}
            syntax={highlight?.[actualSide].get(line.sourceIndex)}
          />
        )}
      </code>
    </div>
  );
}
