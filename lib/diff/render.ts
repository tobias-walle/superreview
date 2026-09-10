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
export type HiddenContext = {
  oldStart: number;
  newStart: number;
  count: number;
};
export function hiddenContextBefore(hunks: Hunk[], index: number): HiddenContext | undefined {
  if (index < 0 || index > hunks.length || !hunks.length) return undefined;
  if (index === 0) {
    const count = Math.min(hunks[0].oldStart, hunks[0].newStart) - 1;
    return count > 0 ? { oldStart: 1, newStart: 1, count } : undefined;
  }
  const previous = hunks[index - 1];
  let oldStart = previous.oldStart;
  let newStart = previous.newStart;
  for (const line of previous.lines) {
    if (line.startsWith("\\")) continue;
    if (!line.startsWith("+")) oldStart++;
    if (!line.startsWith("-")) newStart++;
  }
  // The trailing range is bounded by the captured source once it is loaded.
  if (index === hunks.length) return { oldStart, newStart, count: Infinity };
  const oldCount = hunks[index].oldStart - oldStart;
  const newCount = hunks[index].newStart - newStart;
  if (oldCount <= 0 || oldCount !== newCount) return undefined;
  return { oldStart, newStart, count: oldCount };
}
export type ReviewFile = {
  sourceObjects?: { old: string | null; new: string | null };
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
const WORD_DIFF_CELL_BUDGET = 2_000_000;
const WORD_DIFF_PAIR_BUDGET = 2000;
export type WordDiffBudget = { cells: number; pairs: number };
export const createWordDiffBudget = (): WordDiffBudget => ({
  cells: WORD_DIFF_CELL_BUDGET,
  pairs: WORD_DIFF_PAIR_BUDGET,
});
export function renderHunk(h: Hunk, budget = createWordDiffBudget()) {
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
        if (budget.pairs <= 0 || cells > budget.cells) {
          simplified = true;
          break;
        }
        budget.pairs--;
        budget.cells -= cells;
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
  return { split, unified: lines, new: lines.filter((line) => line.kind !== "del"), simplified };
}

export const BLOCK_ROWS = 24;
export type RowPair = [DiffLine | undefined, DiffLine | undefined];
export type BlockMeta = { count: number; lengths: number[]; sources: number[] };

export function blockIndexForSource(blocks: readonly BlockMeta[], source: number) {
  const exact = blocks.findIndex((block) => block.sources.includes(source));
  // Split blocks can contain distant old/new source indices. Search for an exact
  // match before falling forward when a deletion has been hidden.
  return exact >= 0
    ? exact
    : blocks.findIndex((block) => block.sources.some((next) => next > source));
}
export type HunkMeta = {
  header: string;
  sourceCount: number;
  split: BlockMeta[];
  unified: BlockMeta[];
  new: BlockMeta[];
  simplified: boolean;
};
export type FileMeta = { fingerprint: string; hunks: HunkMeta[] };
export function buildFileModel(file: ReviewFile, budget = createWordDiffBudget()) {
  const hunks = file.hunks.map((hunk) => renderHunk(hunk, budget));
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
        new: blocks(
          h.new.map((r) => r.text.length),
          h.new.map((r) => [r.sourceIndex]),
        ),
      };
    }),
  };
  return { hunks, metadata };
}
