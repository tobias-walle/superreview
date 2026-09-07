import { Gutter, lineSelected } from "./comments";
import { useComments } from "@/hooks/use-comments";
import type { Part, DiffLine } from "@/lib/diff/render";
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
function Highlight({ parts, words }: { parts: Part[]; words: boolean }) {
  const text = parts.map((p) => p.text).join("");
  if (text.length > 4000) return <>{text}</>;
  const syntax: Array<{ start: number; end: number; kind: string }> = [];
  const pattern =
    /(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|const|let|return|if|else|async|await|new|throw|type|interface|function|true|false|undefined|null|for|of)\b|\b\d+\b|\b[A-Za-z_$][\w$]*(?=\())/g;
  for (const m of text.matchAll(pattern)) {
    const t = m[0];
    const kind = t.startsWith("//")
      ? "comment"
      : /^["'`]/.test(t)
        ? "string"
        : /^(import|from|export|const|let|return|if|else|async|await|new|throw|type|interface|function|true|false|undefined|null|for|of)$/.test(
              t,
            )
          ? "keyword"
          : /^\d+$/.test(t)
            ? "number"
            : "function";
    syntax.push({ start: m.index!, end: m.index! + t.length, kind });
  }
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
          ...syntax.flatMap((t) => [t.start, t.end]).filter((x) => x > start && x < end),
          end,
        ].sort((a, b) => a - b);
        return (
          <span key={i} className={words && part.changed ? "word-change" : ""}>
            {points.slice(0, -1).map((x, j) => {
              const token = syntax.find((t) => t.start <= x && t.end > x);
              return (
                <span key={j} className={token ? `token-${token.kind}` : undefined}>
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
  words,
  file,
  hunk,
  side,
}: {
  line?: DiffLine;
  unified?: boolean;
  words: boolean;
  file: number;
  hunk: number;
  side: "old" | "new";
}) {
  const c = useComments();
  const actualSide = unified ? (line?.kind === "del" ? "old" : "new") : side;
  const selected =
    lineSelected(line, file, hunk, actualSide, c) ||
    (unified && line?.kind === "context" && lineSelected(line, file, hunk, "old", c));
  return (
    <div
      className={`code-cell ${line?.kind || "empty"} ${selected ? "comment-selected" : ""}`}
      data-comment-pos={
        line ? `${c.meta[file]?.fingerprint}:${hunk}:${line.sourceIndex}` : undefined
      }
    >
      {unified ? (
        <>
          {line?.oldNo !== undefined ? (
            <Gutter line={line} side="old" file={file} hunk={hunk} />
          ) : (
            <span className="line-no" />
          )}
          {line?.newNo !== undefined ? (
            <Gutter line={line} side="new" file={file} hunk={hunk} />
          ) : (
            <span className="line-no" />
          )}
        </>
      ) : line ? (
        <Gutter line={line} side={side} file={file} hunk={hunk} />
      ) : (
        <span className="line-no" />
      )}
      <span className="line-sign">
        {line?.kind === "add" ? "+" : line?.kind === "del" ? "−" : " "}
      </span>
      {line && <Gutter line={line} side={actualSide} file={file} hunk={hunk} plus />}
      <code className="source">{line && <Highlight parts={line.parts} words={words} />}</code>
    </div>
  );
}
