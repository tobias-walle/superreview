import type { Anchor } from "../comments/model";
import type { BlockMeta, DiffLine, ReviewFile, RowPair } from "./render";

/** Structural on purpose: published guide targets can be passed without coupling
 * diff presentation to guide storage or validation. Ranges are inclusive. */
export type DiffScopeTarget =
  | { kind: "file"; path: string }
  | { kind: "range"; path: string; side: "old" | "new"; start: number; end: number };
export type SourceMask = { old: ReadonlySet<number>; new: ReadonlySet<number> };
export type ScopedFile = { partial: boolean; hunks: SourceMask[] };
/** Keys are ORIGINAL snapshot file indices, never scoped display positions. */
export type DiffScope = ReadonlyMap<number, ScopedFile>;

// Stop at the first changed row, including a replacement's opposite side.
export const SCOPE_CONTEXT_UNCHANGED_ROWS = 3;

export function buildDiffScope(
  files: readonly ReviewFile[],
  targets: readonly DiffScopeTarget[],
): DiffScope {
  const byPath = new Map<string, DiffScopeTarget[]>();
  for (const target of targets) {
    const existing = byPath.get(target.path) || [];
    existing.push(target);
    byPath.set(target.path, existing);
  }
  const scope = new Map<number, ScopedFile>();
  files.forEach((file, index) => {
    const selected = byPath.get(file.path);
    if (!selected) return;
    if (selected.some((target) => target.kind === "file")) {
      scope.set(index, { partial: false, hunks: [] });
      return;
    }
    const hunks = file.hunks.map((hunk) => {
      const mask = { old: new Set<number>(), new: new Set<number>() };
      // Match renderHunk's source indices without rendering or word matching.
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      const lines = hunk.lines.filter((line) => !line.startsWith("\\"));
      const points = lines.map((line) => ({
        unchanged: line.startsWith(" "),
        old: line.startsWith("+") ? undefined : oldNo++,
        new: line.startsWith("-") ? undefined : newNo++,
      }));
      for (const target of selected) {
        if (target.kind !== "range") continue;
        const side = target.side;
        points.forEach((point, source) => {
          const number = point[side];
          if (number === undefined || number < target.start || number > target.end) return;
          mask[side].add(source);
          for (const direction of [-1, 1]) {
            for (let distance = 1; distance <= SCOPE_CONTEXT_UNCHANGED_ROWS; distance++) {
              const adjacent = source + direction * distance;
              if (!points[adjacent]?.unchanged) break;
              mask[side].add(adjacent);
            }
          }
        });
      }
      return mask;
    });
    scope.set(index, { partial: true, hunks });
  });
  return scope;
}

/** Identical content does not make two captured repository paths interchangeable. */
export function anchorFileIndex(files: readonly ReviewFile[], anchor: Anchor): number {
  return files.findIndex(
    (file) => file.path === anchor.path && file.fingerprint === anchor.fingerprint,
  );
}

/** A range with a hidden start, end or interior must escape to the full file.
 * Opposite-side changed rows do not belong to the anchor's range. */
export function scopeContainsAnchor(
  scope: DiffScope | undefined,
  fileIndex: number,
  file: ReviewFile,
  anchor: Anchor,
): boolean {
  if (!scope) return true;
  const scoped = scope.get(fileIndex);
  if (!scoped) return false;
  if (!scoped.partial) return true;
  if (anchor.kind === "file") return false;
  for (let hunk = anchor.start.hunk; hunk <= anchor.end.hunk; hunk++) {
    const lines = file.hunks[hunk]?.lines.filter((line) => !line.startsWith("\\"));
    const mask = scoped.hunks[hunk]?.[anchor.side];
    if (!lines || !mask) return false;
    const start = hunk === anchor.start.hunk ? anchor.start.source : 0;
    const end = hunk === anchor.end.hunk ? anchor.end.source : lines.length - 1;
    if (hunk === anchor.start.hunk && !mask.has(start)) return false;
    if (hunk === anchor.end.hunk && !mask.has(end)) return false;
    for (let source = start; source <= end; source++) {
      const line = lines[source];
      if (!line) return false;
      if (anchor.side === "old" && line.startsWith("+")) continue;
      if (anchor.side === "new" && line.startsWith("-")) continue;
      if (!mask.has(source)) return false;
    }
  }
  return true;
}

export function scopedBlockSources(block: BlockMeta, mask: SourceMask): number[] {
  return block.sources.filter((source) => mask.old.has(source) || mask.new.has(source));
}

export type ScopedRows = { kind: "rows"; rows: RowPair[] } | { kind: "omitted"; changes: boolean };

function selectedLine(line: DiffLine | undefined, side: "old" | "new", mask: SourceMask) {
  if (line && mask[side].has(line.sourceIndex)) return line;
  return undefined;
}

function selectedUnifiedLine(line: DiffLine | undefined, mask: SourceMask) {
  if (!line) return undefined;
  if (line.kind === "del") return selectedLine(line, "old", mask);
  if (line.kind === "add") return selectedLine(line, "new", mask);
  if (mask.old.has(line.sourceIndex) || mask.new.has(line.sourceIndex)) return line;
  return undefined;
}

/** Project ONLY a cached worker block. Retain original line objects, source
 * indices, numbers and word parts. No omitted cell contributes visible evidence. */
export function projectScopedRows(
  rows: readonly RowPair[],
  mask: SourceMask,
  mode: string,
): ScopedRows[] {
  const result: ScopedRows[] = [];
  const omitted = (changes: boolean) => {
    const last = result.at(-1);
    if (last?.kind === "omitted") last.changes ||= changes;
    else result.push({ kind: "omitted", changes });
  };
  let hidingOppositeChanges = false;
  for (const row of rows) {
    let projected: RowPair;
    if (mode === "split") {
      projected = [selectedLine(row[0], "old", mask), selectedLine(row[1], "new", mask)];
    } else {
      projected = [selectedUnifiedLine(row[0], mask), undefined];
    }
    const hiddenChanges = row.some(
      (line, cell) => line && !projected[cell] && line.kind !== "context",
    );
    if (!projected[0] && !projected[1]) {
      omitted(hiddenChanges);
      hidingOppositeChanges = false;
      continue;
    }
    // A blank opposite context cell is not an omitted source row. A run of
    // paired changes with one hidden side needs one boundary, not one per row.
    if (hiddenChanges && !hidingOppositeChanges) omitted(true);
    hidingOppositeChanges = hiddenChanges;
    const last = result.at(-1);
    if (last?.kind === "rows") last.rows.push(projected);
    else result.push({ kind: "rows", rows: [projected] });
  }
  return result;
}
