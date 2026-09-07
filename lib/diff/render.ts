import { wordDiff } from "./word.mjs";
export type Part = { text: string; changed: boolean };
export type DiffLine = {
  kind: "context" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
  parts: Part[];
  sourceIndex: number;
};
export type Hunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: string[];
};
export type ReviewFile = {
  fingerprint?: string;
  changedSinceReview?: boolean;
  changeSummary?: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary?: boolean;
  hunks: Hunk[];
};
export type ReviewData = {
  repository: string;
  repositoryId?: string;
  branch: string;
  files: ReviewFile[];
};
export function renderHunk(h: Hunk) {
  let oldNo = h.oldStart,
    newNo = h.newStart;
  const lines: DiffLine[] = h.lines
    .filter((s) => !s.startsWith("\\"))
    .map((s, sourceIndex) => {
      const kind = s[0] === "+" ? "add" : s[0] === "-" ? "del" : "context";
      return {
        kind,
        sourceIndex,
        text: s.slice(1),
        parts: [{ text: s.slice(1), changed: false }],
        oldNo: kind !== "add" ? oldNo++ : undefined,
        newNo: kind !== "del" ? newNo++ : undefined,
      };
    });
  const split: [DiffLine | undefined, DiffLine | undefined][] = [];
  let remainingCells = 2_000_000;
  let remainingPairs = 2000;
  let simplified = false;
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (l.kind === "context") {
      split.push([l, { ...l, oldNo: undefined }]);
      i++;
      continue;
    }
    const minus: DiffLine[] = [],
      plus: DiffLine[] = [];
    while (i < lines.length && lines[i].kind !== "context") {
      (lines[i].kind === "del" ? minus : plus).push(lines[i++]);
    }
    let pi = 0;
    for (const a of minus) {
      let matched = false;
      for (let j = pi; j < Math.min(plus.length, pi + 24); j++) {
        const cells = (a.text.length + 2) * (plus[j].text.length + 2);
        if (remainingPairs <= 0 || cells > remainingCells) {
          simplified = true;
          break;
        }
        remainingPairs--;
        remainingCells -= cells;
        const wd = wordDiff(a.text, plus[j].text);
        if (wd.distance <= 0.6) {
          while (pi < j) split.push([undefined, plus[pi++]]);
          a.parts = wd.before;
          plus[j].parts = wd.after;
          split.push([a, plus[j]]);
          pi = j + 1;
          matched = true;
          break;
        }
      }
      if (!matched) split.push([a, undefined]);
    }
    while (pi < plus.length) split.push([undefined, plus[pi++]]);
  }
  return { split, unified: lines, simplified };
}

export const BLOCK_ROWS = 24;
export type RowPair = [DiffLine | undefined, DiffLine | undefined];
export type BlockMeta = { count: number; lengths: number[]; sources: number[] };
export type HunkMeta = {
  header: string;
  sourceCount: number;
  split: BlockMeta[];
  unified: BlockMeta[];
  simplified: boolean;
};
export type FileMeta = { fingerprint: string; hunks: HunkMeta[] };
export function buildFileModel(file: ReviewFile) {
  const hunks = file.hunks.map(renderHunk);
  const metadata: FileMeta = {
    fingerprint: "",
    hunks: hunks.map((h, hi) => {
      const blocks = (lengths: number[], sources: number[][]) => {
        const result: BlockMeta[] = [];
        for (let i = 0; i < lengths.length; i += BLOCK_ROWS) {
          const slice = lengths.slice(i, i + BLOCK_ROWS);
          result.push({
            count: slice.length,
            lengths: slice,
            sources: sources.slice(i, i + BLOCK_ROWS).flat(),
          });
        }
        return result;
      };
      return {
        header: file.hunks[hi].header,
        sourceCount: h.unified.length,
        simplified: h.simplified,
        split: blocks(
          h.split.map(([a, b]) => Math.max(a?.text.length || 0, b?.text.length || 0)),
          h.split.map((r) => [...new Set(r.filter(Boolean).map((l) => l!.sourceIndex))]),
        ),
        unified: blocks(
          h.unified.map((r) => r.text.length),
          h.unified.map((r) => [r.sourceIndex]),
        ),
      };
    }),
  };
  return { hunks, metadata };
}
