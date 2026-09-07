import type { DiffLine, FileMeta, ReviewData } from "../diff/render";
export type Side = "old" | "new";
export type Point = {
  hunk: number;
  source: number;
  line: number;
  text: string;
};
export type Anchor = {
  snapshotId?: string;
  path: string;
  fingerprint: string;
  side: Side;
  start: Point;
  end: Point;
  excerpt: string;
};
export type Message = {
  id: string;
  body: string;
  created: number;
  edited?: number;
  deleted?: boolean;
};
export type Thread = {
  resolved?: boolean;
  id: string;
  anchor: Anchor;
  messages: Message[];
  created: number;
};
export type Draft = {
  id: string;
  anchor: Anchor;
  threadId?: string;
  messageId?: string;
  body: string;
};
export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const comparePoints = (a: Point, b: Point) => a.hunk - b.hunk || a.source - b.source;
export function point(line: DiffLine, hunk: number, side: Side): Point {
  return {
    hunk,
    source: line.sourceIndex,
    line: (side === "old" ? line.oldNo : line.newNo)!,
    text: line.text,
  };
}
export function range(anchor: Anchor, end: Point): Anchor {
  const [start, last] =
    comparePoints(anchor.start, end) <= 0 ? [anchor.start, end] : [end, anchor.start];
  return {
    ...anchor,
    start,
    end: last,
    excerpt: start.text + (comparePoints(start, last) ? "\n…\n" + last.text : ""),
  };
}
export function label(a: Anchor) {
  return `${a.side === "old" ? "Old" : "New"} · L${a.start.line}${comparePoints(a.start, a.end) ? "–" + a.end.line : ""}`;
}
export function currentFile(a: Anchor, data: ReviewData, meta: FileMeta[]) {
  return data.files.findIndex(
    (f, i) => f.path === a.path && meta[i]?.fingerprint === a.fingerprint,
  );
}
export function contains(a: Anchor, path: string, hunk: number, line: DiffLine, side: Side) {
  const p = point(line, hunk, side);
  return (
    a.path === path &&
    a.side === side &&
    comparePoints(p, a.start) >= 0 &&
    comparePoints(p, a.end) <= 0
  );
}
export function validAnchor(a: unknown): a is Anchor {
  const v = a as Anchor;
  return (
    !!v &&
    typeof v.path === "string" &&
    typeof v.fingerprint === "string" &&
    ["old", "new"].includes(v.side) &&
    [v.start, v.end].every(
      (p) =>
        p &&
        Number.isInteger(p.hunk) &&
        Number.isInteger(p.source) &&
        Number.isInteger(p.line) &&
        typeof p.text === "string",
    ) &&
    typeof v.excerpt === "string"
  );
}
