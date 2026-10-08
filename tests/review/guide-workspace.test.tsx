import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMPTY_GUIDE_SELECTION,
  guideSelection,
  guideTargetAnchor,
  guideTargetChunk,
  guidedFileOrder,
  selectOpeningGuide,
} from "../../hooks/use-guided-review";
import { mergePolledSession } from "../../hooks/use-review-session";
import {
  ChangedFilesSidebar,
  GuideScopeSelector,
} from "../../components/review/changed-files-sidebar";
import { SidebarProvider } from "../../components/ui/sidebar";
import { CommentContext, type Comments } from "../../hooks/use-comments";
import { emptyReview, evolve } from "../../lib/review/core";
import { buildFileTreeEntries, fileNavigation } from "../../lib/diff/file-order";
import { buildDiffScope, scopeContainsAnchor } from "../../lib/diff/scoped-blocks";
import type { ReviewFile } from "../../lib/diff/render";
import type { GuideTarget, PublishedGuide } from "../../lib/review/guide";
import { GUIDE_SOURCE_CONTEXT_LINES, guideSourceLines } from "../../lib/review/guide-source";
import type { ReadySession, Snapshot } from "../../lib/review/types";

const files: ReviewFile[] = ["src/shared.ts", "deploy.sh", "src/other.ts", "docs/readme.md"].map(
  (path, index) => ({
    path,
    fingerprint: `fp-${index}`,
    additions: 2,
    deletions: 2,
    status: "M",
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        newStart: 1,
        lines: ["-before", "+after", "-telemetry before", "+telemetry after"],
      },
    ],
  }),
);
const oldBusiness: GuideTarget = {
  id: "business-old",
  kind: "range",
  path: files[0].path,
  side: "old",
  start: 1,
  end: 1,
};
const newBusiness: GuideTarget = {
  id: "business-new",
  kind: "range",
  path: files[0].path,
  side: "new",
  start: 1,
  end: 1,
};
const telemetry: GuideTarget = {
  id: "telemetry",
  kind: "range",
  path: files[0].path,
  side: "old",
  start: 2,
  end: 2,
};
const deployment: GuideTarget = { id: "deployment", kind: "file", path: files[1].path };

function guide(id = "first", snapshotId = "saved"): PublishedGuide {
  const targets = [oldBusiness, newBusiness, telemetry, deployment];
  return {
    id,
    snapshotId,
    created: 1,
    author: { kind: "agent", id: "agent", name: "Assistant" },
    artifactHash: "artifact",
    requestHash: "request",
    snapshotHash: "snapshot",
    chunkIds: ["business", "remaining"],
    bundle: {
      manifest: {
        schema: 1,
        snapshotId,
        chunks: [
          {
            id: "business",
            title: "Business rules",
            content: "business.md",
            targets: [oldBusiness, newBusiness],
          },
          {
            id: "remaining",
            kind: "remaining",
            title: "Remaining changes",
            content: "remaining.md",
            targets: [telemetry, deployment],
          },
        ],
      },
      documents: {
        "business.md": "Summary.\n\n## Walkthrough\n\nInspect the rules.",
        "remaining.md": "Inspect telemetry and deployment.",
      },
    },
    resolvedTargets: Object.fromEntries(
      targets.map((target) => {
        const fileIndex = files.findIndex((file) => file.path === target.path);
        const source = target.id === "telemetry" ? 2 : target.id === "business-new" ? 1 : 0;
        const side = target.kind === "range" ? target.side : "new";
        const point = {
          hunk: 0,
          source,
          line: target.kind === "range" ? target.start : 1,
          text: "captured text",
        };
        return [
          target.id,
          {
            target,
            fileIndex,
            fingerprint: `fp-${fileIndex}`,
            sourceObjects: { old: "before-object", new: "after-object" },
            ranges: [{ side, start: point, end: point }],
          },
        ];
      }),
    ),
  };
}
function snapshot(id = "saved"): Snapshot {
  return {
    id,
    created: 1,
    label: "Captured comparison",
    captureView: "full",
    base: "base",
    target: "target",
    data: { repository: "repository", branch: "main", files },
    evidence: {},
  };
}
function session(id = "saved"): ReadySession {
  const state = emptyReview({
    schema: 1,
    id: "review",
    title: "Review",
    created: 1,
    binding: { repository: "repository", worktree: "worktree", branch: "main" },
  });
  return {
    status: "ready",
    snapshot: snapshot(id),
    state: { ...state, snapshotId: "saved", sequence: 1 },
    drafts: [],
    draftRevision: 0,
  };
}
function opened(revision: PublishedGuide) {
  return {
    type: "opened" as const,
    snapshotId: revision.snapshotId,
    guide: revision,
    errors: [],
    publications: [revision.id],
  };
}

test("opening uses publication order and exact snapshot, falling through damaged newer artifacts", async () => {
  const first = guide();
  const newer = guide("newer");
  first.created = 999;
  newer.created = 1;
  const historical = guide("historical", "older-code");
  const calls: string[] = [];
  const descriptors = [first, newer, historical];
  const loaded = await selectOpeningGuide("saved", descriptors, async (id) => {
    calls.push(id);
    return id === "newer" ? newer : first;
  });
  assert.equal(loaded.guide, newer);
  assert.deepEqual(calls, ["newer"]);
  const fallback = await selectOpeningGuide("saved", descriptors, async (id) => {
    if (id === "newer") throw new Error("Damaged artifact");
    return first;
  });
  assert.equal(fallback.guide, first);
  assert.match(fallback.errors[0], /newer.*Damaged artifact/);
  const unavailable = await selectOpeningGuide("new-code", descriptors, async () =>
    assert.fail("Never load a historical guide for new code"),
  );
  assert.equal(unavailable.guide, null);
});

test("invalid matching artifacts leave All files usable and require validated target coordinates", async () => {
  const invalid = guide();
  delete invalid.resolvedTargets["business-old"];
  const result = await selectOpeningGuide("saved", [invalid], async () => invalid);
  assert.equal(result.guide, null);
  assert.match(result.errors[0], /Validated guide target/);
  assert.deepEqual(guidedFileOrder(files), [0, 2, 1, 3]);
  const wrongSnapshot = guide("mismatch", "wrong-code");
  const mismatch = await selectOpeningGuide(
    "saved",
    [{ ...wrongSnapshot, snapshotId: "saved" }],
    async () => wrongSnapshot,
  );
  assert.equal(mismatch.guide, null);
  assert.match(mismatch.errors[0], /snapshot/);
});

test("explicit All files choice during async opening is not overwritten", async () => {
  const revision = guide();
  let finish!: (value: PublishedGuide) => void;
  const loading = selectOpeningGuide(
    "saved",
    [revision],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let selection = guideSelection(EMPTY_GUIDE_SELECTION, {
    type: "choose",
    snapshotId: "saved",
    chunkId: null,
  });
  finish(revision);
  const result = await loading;
  selection = guideSelection(selection, { ...opened(revision), ...result });
  assert.equal(selection.guide, revision);
  assert.equal(selection.chunkId, null);
  assert.equal(selection.humanChoice, true);
});

test("each snapshot opening resets selection even when an intervening historical guide never finished loading", () => {
  const revision = guide();
  let selection = guideSelection(EMPTY_GUIDE_SELECTION, opened(revision));
  selection = guideSelection(selection, { type: "choose", snapshotId: "saved", chunkId: null });
  selection = guideSelection(selection, { type: "opening", snapshotId: "historical" });
  assert.equal(selection.opened, false);
  assert.equal(selection.guide, null);
  selection = guideSelection(selection, { type: "opening", snapshotId: "saved" });
  selection = guideSelection(selection, opened(guide("newest")));
  assert.equal(selection.guide?.id, "newest");
  assert.equal(selection.chunkId, "business");
  assert.equal(selection.humanChoice, false);
});

test("publication/read-only polling preserves the open revision, scope and immutable worker inputs", () => {
  const first = guide();
  let selection = guideSelection(EMPTY_GUIDE_SELECTION, opened(first));
  selection = guideSelection(selection, {
    type: "choose",
    snapshotId: "saved",
    chunkId: "remaining",
  });
  const old = session();
  old.state.guides = [first];
  old.snapshot.captureView = "since-reviewed";
  const loaded = structuredClone(old);
  loaded.snapshot.captureView = "full";
  loaded.state.sequence++;
  loaded.state.guides.push(guide("newer"));
  loaded.state.guideReads[first.id] = { remaining: true };
  const polled = mergePolledSession(old, loaded);
  assert.equal(polled.snapshot, old.snapshot);
  assert.equal(polled.snapshot.data.files, old.snapshot.data.files);
  assert.equal(polled.snapshot.captureView, "since-reviewed");
  assert.equal(polled.drafts, old.drafts);
  assert.equal(selection.guide, first);
  assert.equal(selection.chunkId, "remaining");
  const reopened = guideSelection(
    EMPTY_GUIDE_SELECTION,
    opened(loaded.state.guides[1] as PublishedGuide),
  );
  assert.equal(reopened.guide?.id, "newer");
});

test("polling follows an actual current-code refresh but preserves explicit historical snapshots", () => {
  const old = session();
  const loaded = session("new-code");
  loaded.snapshot.captureView = "since-reviewed";
  loaded.state.snapshotId = "new-code";
  loaded.state.sequence++;
  assert.equal(mergePolledSession(old, loaded).snapshot, loaded.snapshot);
  assert.equal(mergePolledSession(old, loaded).snapshot.captureView, "since-reviewed");
  const historical = session("historical");
  historical.snapshot.captureView = "full";
  assert.equal(mergePolledSession(historical, loaded).snapshot, historical.snapshot);
  assert.equal(mergePolledSession(historical, loaded).snapshot.captureView, "full");
  assert.equal(mergePolledSession(old, old), old);
});

test("scoped tree, counter and sequential navigation keep one folder-grouped original-index order", () => {
  const targets = [
    deployment,
    { id: "other", kind: "file" as const, path: files[2].path },
    oldBusiness,
  ];
  const order = guidedFileOrder(files, targets);
  assert.deepEqual(order, [0, 2, 1]);
  const scope = buildDiffScope(files, targets);
  const tree = buildFileTreeEntries(
    files.map((file) => file.path),
    new Set(),
    (index) => scope.has(index),
  );
  assert.deepEqual(
    tree.flatMap((entry) => (entry.kind === "file" ? [entry.file] : [])),
    order,
  );
  const collapsed = buildFileTreeEntries(
    files.map((file) => file.path),
    new Set(["src"]),
    (index) => scope.has(index),
  );
  assert.deepEqual(
    collapsed.flatMap((entry) => (entry.kind === "file" ? [entry.file] : [])),
    [1],
  );
  assert.deepEqual(fileNavigation(order, 0), {
    position: 1,
    count: 3,
    previous: undefined,
    next: 2,
  });
  assert.deepEqual(fileNavigation(order, 1), {
    position: 3,
    count: 3,
    previous: 2,
    next: undefined,
  });
  assert.equal(scope.has(3), false);
});

test("scope switches preserve human choice while new revisions start unread", () => {
  const first = guide();
  let selection = guideSelection(EMPTY_GUIDE_SELECTION, opened(first));
  selection = guideSelection(selection, {
    type: "choose",
    snapshotId: "saved",
    chunkId: "remaining",
  });
  selection = guideSelection(selection, { type: "choose", snapshotId: "saved", chunkId: null });
  assert.equal(selection.chunkId, null);
  const unchangedOpening = guideSelection(selection, opened(first));
  assert.equal(unchangedOpening.chunkId, null);
  const next = guide("new-revision");
  const newSelection = guideSelection(selection, opened(next));
  assert.equal(newSelection.chunkId, null);
  const historicalOpening = guideSelection(selection, {
    type: "opening",
    snapshotId: "historical",
  });
  const returned = guideSelection(historicalOpening, opened(first));
  assert.equal(returned.chunkId, "business");
  let review = session().state;
  review = evolve(review, {
    schema: 1,
    id: "publish",
    created: 1,
    sequence: 2,
    type: "guide-published",
    guide: first,
  });
  review = evolve(review, {
    schema: 1,
    id: "read",
    created: 2,
    sequence: 3,
    type: "guide-read",
    guideId: first.id,
    snapshotId: first.snapshotId,
    chunkId: "business",
    read: true,
  });
  review = evolve(review, {
    schema: 1,
    id: "publish-next",
    created: 3,
    sequence: 4,
    type: "guide-published",
    guide: next,
  });
  assert.equal(review.guideReads[first.id].business, true);
  assert.equal(review.guideReads[next.id].business, false);
  assert.deepEqual(review.checkpoints, {});
  assert.deepEqual(review.submissions, []);
  assert.deepEqual(review.threads, []);
});

test("target links preserve old-side validated anchors and reveal the owner chunk or full comparison", () => {
  const revision = guide();
  const anchor = guideTargetAnchor("saved", revision.resolvedTargets.telemetry)!;
  assert.equal(anchor.side, "old");
  assert.equal(anchor.snapshotId, "saved");
  assert.equal(anchor.start, revision.resolvedTargets.telemetry.ranges[0].start);
  assert.equal(anchor.fingerprint, files[0].fingerprint);
  const businessScope = buildDiffScope(files, revision.bundle.manifest.chunks[0].targets);
  assert.equal(scopeContainsAnchor(businessScope, 0, files[0], anchor), false);
  assert.equal(guideTargetChunk(revision, files, "telemetry", anchor), "remaining");
  const outside = { ...anchor, end: revision.resolvedTargets["business-new"].ranges[0].end };
  outside.start = revision.resolvedTargets["business-old"].ranges[0].start;
  outside.end = anchor.end;
  assert.equal(scopeContainsAnchor(businessScope, 0, files[0], outside), false);
  assert.equal(scopeContainsAnchor(undefined, 0, files[0], outside), true);
  assert.equal(guideTargetChunk(revision, files, "unknown", anchor), null);
});

test("partial sidebar statistics disclose full captured-file totals without including out-of-scope files", () => {
  const html = renderToStaticMarkup(
    <CommentContext.Provider value={{ counts: new Map() } as unknown as Comments}>
      <SidebarProvider>
        <ChangedFilesSidebar
          files={files}
          scopeIndices={[0]}
          partialScope
          repository="repository"
          selected={0}
          viewed={[true, true, true, true]}
          readyFiles={files.length}
          drawerOpen={false}
          width={280}
          resizeBounds={{ min: 200, max: 400 }}
          onSelect={() => {}}
          onToggleViewed={() => {}}
          onDrawerChange={() => {}}
          onResize={() => {}}
        />
      </SidebarProvider>
    </CommentContext.Provider>,
  );
  assert.match(html, /full captured-file totals/);
  assert.match(html, /class="stat plus">\+2/);
  assert.match(html, /1 \/ 1 viewed/);
  assert.doesNotMatch(html, /lines changed/);
});

test("source-only ranges request honest full-source fallback instead of invented hunk coordinates", () => {
  const revision = guide();
  const sourceOnly = { ...revision.resolvedTargets.telemetry, ranges: [] };
  assert.equal(guideTargetAnchor("saved", sourceOnly), null);
  const metadataOnly = { ...revision.resolvedTargets.deployment, ranges: [] };
  const fileAnchor = guideTargetAnchor("saved", metadataOnly);
  assert.equal(fileAnchor?.kind, "file");
  assert.equal(fileAnchor?.path, "deploy.sh");
});

test("source-only navigation starts with a numbered target excerpt and can reveal the full source", () => {
  const source = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
  const excerpt = guideSourceLines(source, { start: 10, end: 11 }, false);
  assert.equal(GUIDE_SOURCE_CONTEXT_LINES, 5);
  assert.deepEqual(
    excerpt.map((line) => line.number),
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
  assert.deepEqual(
    excerpt.filter((line) => line.selected).map((line) => line.number),
    [10, 11],
  );
  const full = guideSourceLines(source, { start: 10, end: 11 }, true);
  assert.equal(full[0].number, 1);
  assert.equal(full.at(-1)?.number, 20);
});

test("scope selector uses file-tree rows with independent read checkboxes", () => {
  const revision = guide();
  const html = renderToStaticMarkup(
    <GuideScopeSelector
      chunks={revision.bundle.manifest.chunks}
      reads={{ business: true }}
      filesViewed={{ remaining: true }}
      selectedChunkId="remaining"
      loading={false}
      onSelect={() => {}}
      onGuided={() => {}}
      onRead={() => {}}
      readDisabled={false}
    />,
  );
  assert.match(html, /aria-label="Review scope"/);
  assert.match(html, /class="[^"]*tree-viewed guide-chunk-read[^"]*"/);
  assert.match(html, /All files/);
  assert.ok(html.indexOf("Business rules") < html.indexOf("Remaining changes"));
  assert.match(html, /aria-current="true"[^>]*><span>Remaining changes/);
  assert.match(html, /aria-label="Mark unread: Business rules"/);
  assert.match(html, /aria-label="All files viewed: Remaining changes"/);
  assert.match(html, /data-disabled="" disabled=""/);

  const allFiles = renderToStaticMarkup(
    <GuideScopeSelector
      chunks={revision.bundle.manifest.chunks}
      reads={{ business: true }}
      filesViewed={{ remaining: true }}
      selectedChunkId={null}
      loading={false}
      onSelect={() => {}}
      onGuided={() => {}}
      onRead={() => {}}
      readDisabled={false}
    />,
  );
  assert.doesNotMatch(allFiles, /aria-label="Guide chunks"|Business rules|Remaining changes/);
});
