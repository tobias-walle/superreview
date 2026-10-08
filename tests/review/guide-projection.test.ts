import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cell } from "../../components/review/code";
import { CommentContext, type Comments } from "../../hooks/use-comments";
import { point, type Anchor } from "../../lib/comments/model";
import {
  buildFileModel,
  renderHunk,
  BLOCK_ROWS,
  type ReviewFile,
  type RowPair,
} from "../../lib/diff/render";
import {
  buildDiffScope,
  anchorFileIndex,
  projectScopedRows,
  scopedBlockSources,
  scopeContainsAnchor,
  SCOPE_CONTEXT_UNCHANGED_ROWS,
  type DiffScopeTarget,
  type SourceMask,
  type ScopedRows,
} from "../../lib/diff/scoped-blocks";

function file(lines: string[], path = "src/shared.ts"): ReviewFile {
  return {
    path,
    fingerprint: path,
    status: "M",
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
    hunks: [{ header: "@@ -10 +20 @@", oldStart: 10, newStart: 20, lines }],
  };
}

function target(side: "old" | "new", start: number, end = start): DiffScopeTarget {
  return { kind: "range", path: "src/shared.ts", side, start, end };
}

function maskFor(reviewFile: ReviewFile, targets: DiffScopeTarget[]): SourceMask {
  return buildDiffScope([reviewFile], targets).get(0)!.hunks[0];
}

function visibleRows(parts: ScopedRows[]): RowPair[] {
  return parts.flatMap((part) => (part.kind === "rows" ? part.rows : []));
}

function visibleSources(parts: ScopedRows[]): number[] {
  return [
    ...new Set(
      visibleRows(parts).flatMap((row) => row.flatMap((line) => (line ? [line.sourceIndex] : []))),
    ),
  ];
}

function anchorFor(
  reviewFile: ReviewFile,
  side: "old" | "new",
  start: number,
  end = start,
): Anchor {
  const lines = renderHunk(reviewFile.hunks[0]).unified;
  return {
    path: reviewFile.path,
    fingerprint: reviewFile.fingerprint!,
    side,
    start: point(lines[start], 0, side),
    end: point(lines[end], 0, side),
    excerpt: lines[start].text,
  };
}

test("anchor navigation distinguishes paths with identical captured content", () => {
  const first = file(["-old", "+new"], "src/first.ts");
  const second = file(["-old", "+new"], "src/second.ts");
  first.fingerprint = "shared-content";
  second.fingerprint = "shared-content";
  const anchor = anchorFor(second, "new", 1);
  assert.equal(anchorFileIndex([first, second], anchor), 1);
  assert.equal(anchorFileIndex([first, second], { ...anchor, path: "missing.ts" }), -1);
  assert.equal(anchorFileIndex([first, second], { ...anchor, fingerprint: "stale" }), -1);
});

test("whole-file targets keep original snapshot indices and override partial targets", () => {
  const files = [file(["+first"], "z.ts"), file(["-old", "+new"]), file([], "binary.dat")];
  files[2].binary = true;
  const scope = buildDiffScope(files, [
    target("new", 20),
    { kind: "file", path: files[1].path },
    { kind: "file", path: files[2].path },
  ]);
  assert.deepEqual([...scope.keys()], [1, 2]);
  assert.deepEqual(scope.get(1), { partial: false, hunks: [] });
  assert.deepEqual(scope.get(2), { partial: false, hunks: [] });
  assert.equal(scope.has(0), false);
  assert.equal(buildDiffScope(files, []).size, 0);
});

test("old and new replacement targets do not select the opposite changed side", () => {
  const reviewFile = file([" before", "-const value = 1", "+const value = 2", " after"]);
  const old = maskFor(reviewFile, [target("old", 11)]);
  const next = maskFor(reviewFile, [target("new", 21)]);
  assert.deepEqual([...old.old], [1, 0]);
  assert.deepEqual([...old.new], []);
  assert.deepEqual([...next.old], []);
  assert.deepEqual([...next.new], [2, 3]);
  const rows = renderHunk(reviewFile.hunks[0]).unified.map((line): RowPair => [line, undefined]);
  assert.deepEqual(visibleSources(projectScopedRows(rows, old, "unified")), [0, 1]);
  assert.deepEqual(visibleSources(projectScopedRows(rows, next, "unified")), [2, 3]);
});

test("context is bounded to three unchanged rows and stops before another change", () => {
  assert.equal(SCOPE_CONTEXT_UNCHANGED_ROWS, 3);
  const reviewFile = file([
    " a",
    " b",
    " c",
    " d",
    "+selected",
    " e",
    " f",
    " g",
    " h",
    "+unrelated",
    " tail",
  ]);
  const mask = maskFor(reviewFile, [target("new", 24)]);
  assert.deepEqual(
    [...mask.new].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
  );
  const nearby = file(["+unrelated", " one", "+selected", " two", "+also unrelated"]);
  const nearbyMask = maskFor(nearby, [target("new", 22)]);
  assert.deepEqual(
    [...nearbyMask.new].sort((a, b) => a - b),
    [1, 2, 3],
  );
});

test("inclusive ranges, overlaps and disjoint targets use a source union", () => {
  const reviewFile = file(Array.from({ length: 12 }, (_, index) => `+line ${index}`));
  const mask = maskFor(reviewFile, [
    target("new", 21, 23),
    target("new", 22, 24),
    target("new", 29, 30),
  ]);
  assert.deepEqual(
    [...mask.new].sort((a, b) => a - b),
    [1, 2, 3, 4, 9, 10],
  );
  assert.equal(mask.new.size, 6);
  const rows = renderHunk(reviewFile.hunks[0]).unified.map((line): RowPair => [line, undefined]);
  const parts = projectScopedRows(rows, mask, "unified");
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["omitted", "rows", "omitted", "rows", "omitted"],
  );
  assert.ok(parts.filter((part) => part.kind === "omitted").every((part) => part.changes));
  assert.deepEqual(visibleSources(parts), [1, 2, 3, 4, 9, 10]);
});

test("no-newline markers do not shift source coordinates or original hunk indices", () => {
  const reviewFile = file([
    "-before",
    "\\ No newline at end of file",
    "+after",
    "\\ No newline at end of file",
  ]);
  reviewFile.hunks.push({
    header: "@@ -40 +50 @@",
    oldStart: 40,
    newStart: 50,
    lines: ["-later before", "+later after"],
  });
  const scope = buildDiffScope([reviewFile], [target("new", 20), target("old", 40)]);
  assert.equal(scope.get(0)!.hunks.length, 2);
  assert.deepEqual([...scope.get(0)!.hunks[0].new], [1]);
  assert.deepEqual([...scope.get(0)!.hunks[1].old], [0]);
  assert.equal(scope.get(0)!.hunks[0].old.size, 0);
  assert.equal(scope.get(0)!.hunks[1].new.size, 0);
});

test("split masks isolate paired replacements while retaining original line objects", () => {
  const reviewFile = file(["-const value = 1", "+const value = 2"]);
  const rendered = renderHunk(reviewFile.hunks[0]);
  assert.ok(rendered.split[0][0] && rendered.split[0][1], "fixture is a paired replacement");
  for (const side of ["old", "new"] as const) {
    const mask = maskFor(reviewFile, [target(side, side === "old" ? 10 : 20)]);
    const parts = projectScopedRows(rendered.split, mask, "split");
    assert.deepEqual(
      parts.map((part) => part.kind),
      ["omitted", "rows"],
    );
    const [row] = visibleRows(parts);
    const cell = side === "old" ? 0 : 1;
    assert.equal(row[cell], rendered.split[0][cell]);
    assert.equal(row[1 - cell], undefined);
    assert.deepEqual(visibleSources(parts), [side === "old" ? 0 : 1]);
  }
  assert.ok(
    rendered.split[0][0] && rendered.split[0][1],
    "projection does not mutate the cached pair",
  );
});

test("one-sided split context does not produce an omission marker for each blank cell", () => {
  const rendered = renderHunk(file([" a", " b", " c"]).hunks[0]);
  const mask = { old: new Set<number>(), new: new Set([0, 1, 2]) };
  const parts = projectScopedRows(rendered.split, mask, "split");
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["rows"],
  );
  assert.equal(visibleRows(parts).length, 3);
  assert.ok(visibleRows(parts).every(([old, next]) => !old && next));
});

test("a consecutive run of hidden opposite changes needs one explicit boundary", () => {
  const reviewFile = file(["-const a = 1", "-const b = 1", "+const a = 2", "+const b = 2"]);
  const rendered = renderHunk(reviewFile.hunks[0]);
  assert.equal(rendered.split.length, 2);
  assert.ok(rendered.split.every(([old, next]) => old && next));
  const parts = projectScopedRows(
    rendered.split,
    maskFor(reviewFile, [target("new", 20, 21)]),
    "split",
  );
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["omitted", "rows"],
  );
  assert.deepEqual(visibleSources(parts), [2, 3]);
});

test("omitted context and omitted changes are distinguished and adjacent omissions collapse", () => {
  const reviewFile = file([" context", "-hidden", "+shown", " tail"]);
  const rows = renderHunk(reviewFile.hunks[0]).unified.map((line): RowPair => [line, undefined]);
  const parts = projectScopedRows(rows, { old: new Set(), new: new Set([2]) }, "unified");
  assert.deepEqual(
    parts.filter((part) => part.kind === "omitted"),
    [
      { kind: "omitted", changes: true },
      { kind: "omitted", changes: false },
    ],
  );
  assert.deepEqual(projectScopedRows([], { old: new Set(), new: new Set() }, "split"), []);
});

test("large scopes retain original worker block sources rather than renumbering selected rows", () => {
  const reviewFile = file(Array.from({ length: BLOCK_ROWS * 4 }, (_, index) => `+line ${index}`));
  const model = buildFileModel(reviewFile);
  const source = BLOCK_ROWS * 2 + 3;
  const mask = maskFor(reviewFile, [target("new", 20 + source)]);
  const blocks = model.metadata.hunks[0].unified;
  assert.deepEqual(
    blocks.map((block) => scopedBlockSources(block, mask)),
    [[], [], [source], []],
  );
  const rows = model.hunks[0].unified
    .slice(BLOCK_ROWS * 2, BLOCK_ROWS * 3)
    .map((line): RowPair => [line, undefined]);
  const parts = projectScopedRows(rows, mask, "unified");
  const [row] = visibleRows(parts);
  assert.equal(row[0], model.hunks[0].unified[source]);
  assert.equal(row[0]!.sourceIndex, source);
  assert.equal(row[0]!.newNo, 20 + source);
  assert.equal(blocks.length, 4);
  assert.ok(blocks.every((block) => block.count <= BLOCK_ROWS));
});

test("only visible original sources contribute coverage, including new-only worker blocks", () => {
  const reviewFile = file([
    " context",
    "-const value = 1",
    "+const value = 2",
    " after",
    "+unrelated",
  ]);
  const model = buildFileModel(reviewFile);
  const mask = maskFor(reviewFile, [target("new", 21)]);
  for (const mode of ["unified", "split", "new"] as const) {
    const rows =
      mode === "split"
        ? model.hunks[0].split
        : model.hunks[0][mode].map((line): RowPair => [line, undefined]);
    const parts = projectScopedRows(rows, mask, mode);
    assert.deepEqual(visibleSources(parts), [2, 3]);
    assert.deepEqual(
      model.metadata.hunks[0][mode].flatMap((block) => scopedBlockSources(block, mask)),
      [2, 3],
    );
    assert.ok(visibleSources(parts).length < model.metadata.hunks[0].sourceCount);
  }
});

test("a deletion-only scope has no new-side code or evidence even when unrelated additions exist", () => {
  const reviewFile = file(["-gone", "-also gone", "+unrelated"]);
  const model = buildFileModel(reviewFile);
  const mask = maskFor(reviewFile, [target("old", 10, 11)]);
  assert.deepEqual([...mask.old], [0, 1]);
  assert.equal(mask.new.size, 0);
  assert.deepEqual(
    model.metadata.hunks[0].new.flatMap((block) => scopedBlockSources(block, mask)),
    [],
  );
  const rows = model.hunks[0].new.map((line): RowPair => [line, undefined]);
  assert.deepEqual(visibleRows(projectScopedRows(rows, mask, "new")), []);
  const deleted = {
    ...reviewFile,
    status: "D",
    hunks: [{ ...reviewFile.hunks[0], newStart: 0, lines: ["-gone"] }],
  };
  const deletedModel = buildFileModel(deleted);
  assert.equal(deletedModel.metadata.hunks[0].new.length, 0);
  assert.deepEqual(
    visibleSources(
      projectScopedRows(
        deletedModel.hunks[0].split,
        maskFor(deleted, [target("old", 10)]),
        "split",
      ),
    ),
    [0],
  );
});

test("projected cells retain original comment anchors and omit hidden-side comment controls", () => {
  const reviewFile = file(["-const value = 1", "+const value = 2"]);
  const rendered = renderHunk(reviewFile.hunks[0]);
  const [row] = visibleRows(
    projectScopedRows(rendered.split, maskFor(reviewFile, [target("new", 20)]), "split"),
  );
  const comments = {
    data: { files: [reviewFile] },
    meta: [{ fingerprint: "original" }],
    drafts: [],
    threads: [],
    selection: null,
    editor: null,
  } as unknown as Comments;
  const html = renderToStaticMarkup(
    React.createElement(
      CommentContext.Provider,
      { value: comments },
      React.createElement(
        "div",
        null,
        React.createElement(Cell, { line: row[0], file: 0, hunk: 0, side: "old", words: true }),
        React.createElement(Cell, { line: row[1], file: 0, hunk: 0, side: "new", words: true }),
      ),
    ),
  );
  assert.match(html, /data-comment-pos="original:0:1"/);
  assert.match(html, /Select new line 20/);
  assert.doesNotMatch(html, /Select old line|data-comment-pos="original:0:0"/);
  assert.deepEqual(point(row[1]!, 0, "new"), {
    hunk: 0,
    source: 1,
    line: 20,
    text: "const value = 2",
  });
});

test("anchor membership respects original indices, sides, endpoints and hidden interiors", () => {
  const reviewFile = file(Array.from({ length: 8 }, (_, index) => `+line ${index}`));
  const scope = buildDiffScope(
    [file([], "other.ts"), reviewFile],
    [target("new", 21), target("new", 25)],
  );
  assert.equal(scopeContainsAnchor(scope, 1, reviewFile, anchorFor(reviewFile, "new", 1)), true);
  assert.equal(scopeContainsAnchor(scope, 0, reviewFile, anchorFor(reviewFile, "new", 1)), false);
  assert.equal(scopeContainsAnchor(scope, 1, reviewFile, anchorFor(reviewFile, "new", 2)), false);
  assert.equal(
    scopeContainsAnchor(scope, 1, reviewFile, anchorFor(reviewFile, "new", 1, 5)),
    false,
  );
  assert.equal(
    scopeContainsAnchor(scope, 1, reviewFile, anchorFor(reviewFile, "new", 0, 1)),
    false,
  );
  assert.equal(
    scopeContainsAnchor(scope, 1, reviewFile, { ...anchorFor(reviewFile, "new", 1), kind: "file" }),
    false,
  );
  assert.equal(
    scopeContainsAnchor(undefined, 1, reviewFile, anchorFor(reviewFile, "new", 2)),
    true,
  );
  assert.equal(
    scopeContainsAnchor(
      buildDiffScope([reviewFile], [{ kind: "file", path: reviewFile.path }]),
      0,
      reviewFile,
      { ...anchorFor(reviewFile, "new", 1), kind: "file" },
    ),
    true,
  );
  const context = file([" context", "-before", "+after"]);
  const newScope = buildDiffScope([context], [target("new", 20)]);
  assert.equal(scopeContainsAnchor(newScope, 0, context, anchorFor(context, "new", 0)), true);
  assert.equal(scopeContainsAnchor(newScope, 0, context, anchorFor(context, "old", 0)), false);
});

test("anchors spanning hunks ignore opposite-side sources but retain original hunk coordinates", () => {
  const reviewFile = file(["+first", "-opposite"]);
  reviewFile.hunks.push({
    header: "@@ -40 +50 @@",
    oldStart: 40,
    newStart: 50,
    lines: ["-opposite", "+last"],
  });
  const anchor = anchorFor(reviewFile, "new", 0);
  anchor.end = point(renderHunk(reviewFile.hunks[1]).unified[1], 1, "new");
  const scope = buildDiffScope([reviewFile], [target("new", 20), target("new", 50)]);
  assert.equal(scopeContainsAnchor(scope, 0, reviewFile, anchor), true);
});
