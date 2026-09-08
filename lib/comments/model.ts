import type { DiffLine, FileMeta, ReviewData } from "../diff/render";
export type Side = "old" | "new";
export type Point = {
  hunk: number;
  source: number;
  line: number;
  text: string;
};
export type Anchor = {
  kind?: "line" | "file";
  snapshotId?: string;
  path: string;
  fingerprint: string;
  side: Side;
  start: Point;
  end: Point;
  excerpt: string;
};
export type Author = {
  id: string;
  name: string;
  kind: "human" | "agent";
};
export const LOCAL_HUMAN: Author = { id: "local-user", name: "You", kind: "human" };
export type Message = {
  id: string;
  body: string;
  created: number;
  author?: Author;
  edited?: number;
  editedBy?: Author;
  deleted?: boolean;
  deletedBy?: Author;
};
export type Thread = {
  resolved?: boolean;
  resolvedAt?: number;
  resolvedBy?: Author;
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
  if (a.kind === "file") return "File comment";
  return `${a.side === "old" ? "Old" : "New"} · L${a.start.line}${comparePoints(a.start, a.end) ? "–" + a.end.line : ""}`;
}
export function authorName(author?: Author) {
  return author?.name || "Legacy author unknown";
}
export function authorInitial(author?: Author) {
  return author?.name.trim().slice(0, 1).toUpperCase() || "?";
}
export function currentFile(a: Anchor, data: ReviewData, meta: FileMeta[]) {
  return data.files.findIndex(
    (f, i) => f.path === a.path && meta[i]?.fingerprint === a.fingerprint,
  );
}
export function contains(a: Anchor, path: string, hunk: number, line: DiffLine, side: Side) {
  if (a.kind === "file") return false;
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
    (v.kind === undefined || v.kind === "line" || v.kind === "file") &&
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
