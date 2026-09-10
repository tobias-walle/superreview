import test from "node:test";
import assert from "node:assert/strict";
import { range, type Anchor, type Draft } from "../../lib/comments/model";
import { numberedRange, retargetDraft, selectionPoint } from "../../lib/comments/selection";
import type { ReviewData } from "../../lib/diff/render";

const data = {
  files: [
    {
      path: "example.ts",
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [" first", "-old", "+replacement", " third", " fourth", " fifth"],
        },
        { oldStart: 20, newStart: 20, lines: [" last"] },
      ],
    },
  ],
} as ReviewData;
const anchor: Anchor = {
  path: "example.ts",
  fingerprint: "content",
  side: "new",
  excerpt: "third",
  start: { hunk: 0, source: 3, line: 3, text: "third" },
  end: { hunk: 0, source: 3, line: 3, text: "third" },
};
const draft: Draft = { id: "stable-draft", body: "Do not lose **this text**", anchor };

test("extending and shrinking a draft preserves its identity and text, refreshing evidence", () => {
  const extended = retargetDraft(
    draft,
    range(anchor, selectionPoint(data, anchor, 5)!),
    data,
    "snapshot",
  );
  assert.equal(extended?.id, draft.id);
  assert.equal(extended?.body, draft.body);
  assert.equal(extended?.anchor.excerpt, "3: third\n4: fourth\n5: fifth");
  assert.equal(extended?.anchor.snapshotId, "snapshot");
  const shrunk = retargetDraft(
    extended,
    range(anchor, selectionPoint(data, anchor, 4)!),
    data,
    "snapshot",
  );
  assert.equal(shrunk?.anchor.end.line, 4);
  assert.equal(shrunk?.body, draft.body);
  assert.equal(draft.anchor.end.line, 3);
});

test("range adjustment can cross the original starting line without moving that pivot", () => {
  const upward = range(anchor, selectionPoint(data, anchor, 1)!);
  assert.deepEqual([upward.start.line, upward.end.line], [1, 3]);
  const downward = range(anchor, selectionPoint(data, anchor, 5)!);
  assert.deepEqual([downward.start.line, downward.end.line], [3, 5]);
});

test("range changes cannot move replies, edits, file comments or drafts to another file or side", () => {
  for (const protectedDraft of [
    { ...draft, threadId: "thread" },
    { ...draft, messageId: "message" },
    { ...draft, anchor: { ...anchor, kind: "file" as const } },
  ])
    assert.equal(retargetDraft(protectedDraft, anchor, data, "snapshot"), undefined);
  for (const target of [
    { ...anchor, path: "other.ts" },
    { ...anchor, side: "old" as const },
    { ...anchor, fingerprint: "different-content" },
  ])
    assert.equal(retargetDraft(draft, target, data, "snapshot"), undefined);
});

test("mobile ranges resolve real side-specific points and reject invalid or hidden endpoints", () => {
  const selected = numberedRange(data, anchor, 2, 4)!;
  assert.equal(selected.start.source, 2);
  assert.equal(selected.end.source, 4);
  const old = numberedRange(data, { ...anchor, side: "old" }, 2, 4)!;
  assert.equal(old.start.source, 1);
  for (const [start, end] of [
    [4, 2],
    [0, 3],
    [1.5, 3],
    [3, 10],
    [NaN, 3],
  ]) {
    assert.equal(numberedRange(data, anchor, start, end), undefined);
  }
  assert.equal(numberedRange(data, anchor, 3, 20)?.end.hunk, 1);
});
