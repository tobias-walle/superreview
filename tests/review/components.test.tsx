import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewDocumentTitle } from "../../client/document-title";
import { Markdown } from "../../components/review/markdown";
import { CopyButton } from "../../components/review/copy-button";
import { ThreadView } from "../../components/review/comment-thread";
import { buildFileTreeEntries } from "../../components/review/file-tree";
import { resizeSidebarWidth } from "../../components/review/sidebar-resizer";
import { CommentContext, type Comments } from "../../hooks/use-comments";
import { canMarkAutomatically, checkpointMatches } from "../../lib/review/checkpoints";
import type { Thread } from "../../lib/comments/model";

test("document title identifies the project, branch, and comparison", () => {
  assert.equal(
    reviewDocumentTitle("superreview", "feature/title"),
    "superreview ⋅ feature/title ⋅ local",
  );
  assert.equal(
    reviewDocumentTitle("superreview", "feature/title", ["main", "feature/title"]),
    "superreview ⋅ feature/title ⋅ main → feature/title",
  );
  assert.equal(
    reviewDocumentTitle("superreview", "feature/title", ["main...HEAD"]),
    "superreview ⋅ feature/title ⋅ main...HEAD",
  );
});

test("sidebar resizing follows its edge and respects width bounds", () => {
  const bounds = { min: 200, max: 400 };

  assert.equal(resizeSidebarWidth(250, 30, 1, bounds), 280);
  assert.equal(resizeSidebarWidth(300, -40, -1, bounds), 340);
  assert.equal(resizeSidebarWidth(250, -100, 1, bounds), bounds.min);
  assert.equal(resizeSidebarWidth(300, -200, -1, bounds), bounds.max);
});

test("file tree compacts chains containing only one folder", () => {
  const paths = [
    "agents/claim/src/package/application/use_cases/link_claim/observe.py",
    "agents/claim/src/package/domain/models.py",
    "agents/claim/src/package/tests/test_claim.py",
  ];

  const entries = buildFileTreeEntries(paths, new Set());
  assert.deepEqual(entries.slice(0, 3), [
    {
      kind: "folder",
      key: "folder:agents/claim/src/package",
      label: "agents/claim/src/package",
      path: "agents/claim/src/package",
      depth: 0,
      count: 3,
    },
    {
      kind: "folder",
      key: "folder:agents/claim/src/package/application/use_cases/link_claim",
      label: "application/use_cases/link_claim",
      path: "agents/claim/src/package/application/use_cases/link_claim",
      depth: 1,
      count: 1,
    },
    {
      kind: "file",
      key: paths[0],
      file: 0,
      depth: 2,
    },
  ]);

  assert.deepEqual(buildFileTreeEntries(paths, new Set(["agents/claim/src/package"])), [
    entries[0],
  ]);
});

test("comment Markdown renders lists and fenced code but never raw HTML or remote images", () => {
  const html = renderToStaticMarkup(
    <Markdown
      body={
        "**Feedback**\n\n- Check expiry\n\n```ts\nvalidate(token)\n```\n\n<script>alert(1)</script>\n\n![remote](https://example.com/private.png)\n\n[unsafe](javascript:alert(1))"
      }
    />,
  );
  assert.match(html, /<strong>Feedback<\/strong>/);
  assert.match(html, /<li>Check expiry<\/li>/);
  assert.match(html, /<code class="language-ts">/);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
});
test("a previous-diff thread remains readable and resolved state is a separate reversible action", () => {
  const thread: Thread = {
    id: "t1",
    created: 1,
    resolved: true,
    anchor: {
      snapshotId: "snap",
      path: "src/auth.ts",
      fingerprint: "f",
      side: "old",
      start: { line: 2, hunk: 0, source: 1, text: "before" },
      end: { line: 4, hunk: 0, source: 3, text: "after" },
      excerpt: "before\nmiddle\nafter",
    },
    messages: [{ id: "m1", body: "**Validate** this value", created: 1 }],
  };
  const comments = {
    active: "t1",
    editor: null,
    drafts: [],
    setActive() {},
    setEditor() {},
    begin() {},
    resolve() {},
  } as unknown as Comments;
  const html = renderToStaticMarkup(
    <CommentContext.Provider value={comments}>
      <ThreadView thread={thread} previous />
    </CommentContext.Provider>,
  );
  assert.match(html, /Previous diff/);
  assert.match(html, /before\nmiddle\nafter/);
  assert.match(html, /Reopen thread/);
  assert.match(html, /Copy thread/);
  assert.match(html, /aria-expanded="true"/);
});
test("copy is an independent action, with an accessible descriptive label", () => {
  const html = renderToStaticMarkup(<CopyButton text="# Submission" />);
  assert.match(html, /Copy as Markdown/);
  assert.ok(!html.includes("Submit review"));
});
test("manual unview survives viewport coverage for the same content but does not hide changed content", () => {
  const evidence = {
    key: "v1",
    before: { object: "old", mode: "100644" },
    after: { object: "new", mode: "100644" },
  };
  const checkpoint = {
    path: "src/auth.ts",
    fingerprint: "f1",
    viewed: false,
    manual: true,
    snapshotId: "s1",
    created: 1,
    evidence,
  };
  assert.equal(checkpointMatches(checkpoint, evidence, "f2"), true);
  assert.equal(canMarkAutomatically(checkpoint, evidence, "f2"), false);
  assert.equal(checkpointMatches(checkpoint, { ...evidence, key: "v2" }, "f1"), false);
  assert.equal(canMarkAutomatically(checkpoint, { ...evidence, key: "v2" }, "f1"), true);
});
