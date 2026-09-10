import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewDocumentTitle } from "../../client/document-title";
import { Markdown } from "../../components/review/markdown";
import { CopyButton } from "../../components/review/copy-button";
import { Cell, Highlight } from "../../components/review/code";
import { ThreadView } from "../../components/review/comment-thread";
import { Composer } from "../../components/review/comment-editor";
import { buildFileTreeEntries } from "../../components/review/file-tree";
import { resizeSidebarWidth } from "../../components/review/sidebar-resizer";
import { CommentContext, filterVisibleThreads, type Comments } from "../../hooks/use-comments";
import { canMarkAutomatically, checkpointMatches } from "../../lib/review/checkpoints";
import { agentRequest, exportThread } from "../../lib/review/markdown";
import type { ReviewIdentity, Submission } from "../../lib/review/types";
import type { Draft, Thread } from "../../lib/comments/model";
import { hiddenContextBefore, type Hunk } from "../../lib/diff/render";
import { highlightHunk, languageForPath } from "../../lib/syntax/highlight";

test("unified gutters only offer commenting on sides with an actual line", () => {
  const comments = {
    data: { files: [{ path: "example.ts" }] },
    meta: [{ fingerprint: "content" }],
    drafts: [],
    threads: [],
    selection: null,
    editor: null,
  } as unknown as Comments;
  const html = renderToStaticMarkup(
    <CommentContext.Provider value={comments}>
      <Cell
        file={0}
        hunk={0}
        side="new"
        unified
        words={false}
        line={{
          kind: "add",
          newNo: 2,
          sourceIndex: 1,
          text: "added",
          parts: [{ text: "added", changed: false }],
        }}
      />
    </CommentContext.Provider>,
  );
  assert.match(html, /Select new line 2/);
  assert.doesNotMatch(html, /Select old line|line undefined|line-comment-add/);
  assert.equal((html.match(/<button/g) || []).length, 1);
});

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

test("syntax highlighting recognizes file types and preserves word highlights", async () => {
  assert.equal(languageForPath("src/example.tsx"), "tsx");
  assert.ok(languageForPath("scripts/release.py"));
  assert.equal(languageForPath("Dockerfile"), "dockerfile");
  assert.equal(languageForPath("assets/data.unknown-extension"), undefined);

  const hunk: Hunk = {
    header: "@@ -1,2 +1,2 @@",
    oldStart: 1,
    newStart: 1,
    lines: [" const answer = 1;", "-const oldValue = answer;", "+const newValue = answer;"],
  };
  const highlighted = await highlightHunk("src/example.ts", hunk);
  assert.ok(highlighted);
  assert.equal(
    highlighted.old
      .get(0)
      ?.map((token) => token.text)
      .join(""),
    "const answer = 1;",
  );
  assert.equal(
    highlighted.old
      .get(1)
      ?.map((token) => token.text)
      .join(""),
    "const oldValue = answer;",
  );
  assert.equal(
    highlighted.new
      .get(2)
      ?.map((token) => token.text)
      .join(""),
    "const newValue = answer;",
  );
  assert.equal(highlighted.old.has(2), false);
  assert.equal(highlighted.new.has(1), false);

  const statefulHunk: Hunk = {
    header: "@@ -2 +2 @@",
    oldStart: 2,
    newStart: 2,
    lines: [" from claim_linking import candidate"],
  };
  const isolated = await highlightHunk("example.py", statefulHunk);
  const fromFullFile = await highlightHunk("example.py", statefulHunk, {
    old: '"""\nfrom claim_linking import candidate\n"""\n',
    new: '"""\nfrom claim_linking import candidate\n"""\n',
    key: "python-string-object",
  });
  assert.ok(isolated && fromFullFile);
  assert.notEqual(
    isolated.old.get(0)?.[0]?.mocha,
    fromFullFile.old.get(0)?.[0]?.mocha,
    "full-file parser state treats the apparent import as string content",
  );

  const html = renderToStaticMarkup(
    <Highlight
      parts={[
        { text: "const ", changed: false },
        { text: "answer", changed: true },
      ]}
      words
      syntax={[
        { text: "const", mocha: "#fff", latte: "#000", fontStyle: 0 },
        { text: " answer", mocha: "#eee", latte: "#111", fontStyle: 0 },
      ]}
    />,
  );
  assert.match(html, /class="syntax-token"/);
  assert.match(html, /class="word-change"/);
  assert.equal(html.replace(/<[^>]+>/g, ""), "const answer");
});

test("hidden context is measured between adjacent hunks", () => {
  const hunks: Hunk[] = [
    {
      header: "@@ -1,3 +1,3 @@",
      oldStart: 1,
      newStart: 1,
      lines: [" first", "-before", "+after", " third"],
    },
    {
      header: "@@ -10 +10 @@",
      oldStart: 10,
      newStart: 10,
      lines: [" tenth"],
    },
  ];

  assert.deepEqual(hiddenContextBefore(hunks, 1), {
    oldStart: 4,
    newStart: 4,
    count: 6,
  });
  assert.equal(hiddenContextBefore(hunks, 0), undefined);
  assert.deepEqual(hiddenContextBefore([{ ...hunks[0], oldStart: 8, newStart: 8 }], 0), {
    oldStart: 1,
    newStart: 1,
    count: 7,
  });
  assert.deepEqual(hiddenContextBefore(hunks, hunks.length), {
    oldStart: 11,
    newStart: 11,
    count: Infinity,
  });
  assert.equal(hiddenContextBefore([], 0), undefined);
  assert.equal(
    hiddenContextBefore([hunks[0], { ...hunks[1], newStart: 11 }], 1),
    undefined,
    "only unchanged ranges can be expanded as shared context",
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
  assert.match(html, /Legacy author unknown/);
  const header = html.slice(
    html.indexOf('class="thread-header"'),
    html.indexOf('class="thread-content"'),
  );
  assert.match(header, /aria-label="Reopen thread"/);
  assert.match(header, /aria-label="Copy thread"/);
  assert.ok(header.indexOf("</button>") < header.indexOf('aria-label="Reopen thread"'));
  assert.doesNotMatch(html, /thread-tools/);
});
test("composers keep Markdown editing without preview and only standalone editors repeat the path", () => {
  const draft: Draft = {
    id: "draft",
    body: "**Keep my text**",
    anchor: {
      path: "src/example.ts",
      fingerprint: "f",
      side: "new",
      start: { line: 3, hunk: 0, source: 2, text: "start" },
      end: { line: 5, hunk: 0, source: 4, text: "end" },
      excerpt: "start\nend",
    },
  };
  const comments = { error: "" } as unknown as Comments;
  for (const variant of [
    draft,
    { ...draft, threadId: "t" },
    { ...draft, threadId: "t", messageId: "m" },
  ]) {
    for (const inline of [true, false]) {
      const html = renderToStaticMarkup(
        <CommentContext.Provider value={comments}>
          <Composer draft={variant} inline={inline} />
        </CommentContext.Provider>,
      );
      assert.match(html, /<textarea[^>]*aria-label="Comment Markdown"/);
      assert.match(html, /\*\*Keep my text\*\*/);
      assert.match(html, /Draft saved/);
      assert.doesNotMatch(html, /Preview|role="tab|markdown-preview/);
      assert.equal(html.includes('class="composer-path"'), !inline);
      assert.equal(html.includes('aria-label="Start line"'), !variant.threadId);
      assert.equal(html.includes("Shift-click to adjust"), !variant.threadId);
    }
  }
  const copy = renderToStaticMarkup(<CopyButton text="thread" label="Copy thread" iconOnly />);
  assert.match(copy, /aria-label="Copy thread"/);
  assert.match(copy, /title="Copy thread"/);
  assert.doesNotMatch(copy, />Copy thread</);
});

test("resolved comments are hidden unless requested or they contain a draft", () => {
  const open = { id: "open", resolved: false } as Thread;
  const resolved = { id: "resolved", resolved: true } as Thread;
  const resolvedDraft = { id: "resolved-draft", resolved: true } as Thread;
  const threads = [open, resolved, resolvedDraft];

  assert.deepEqual(
    filterVisibleThreads(threads, false, new Set([resolvedDraft.id])).map((thread) => thread.id),
    [open.id, resolvedDraft.id],
  );
  assert.deepEqual(
    filterVisibleThreads(threads, true).map((thread) => thread.id),
    threads.map((thread) => thread.id),
  );
});
test("agent attribution is visible in threads and Markdown exports", () => {
  const agentThread: Thread = {
    id: "agent-thread",
    created: 1,
    anchor: {
      snapshotId: "snap",
      path: "src/auth.ts",
      fingerprint: "f",
      side: "new",
      start: { line: 2, hunk: 0, source: 1, text: "value" },
      end: { line: 2, hunk: 0, source: 1, text: "value" },
      excerpt: "2: value",
    },
    messages: [
      {
        id: "agent-message",
        body: "I ran the test.",
        created: 1,
        author: { id: "agent", name: "Build agent", kind: "agent" },
      },
    ],
  };
  const comments = {
    active: agentThread.id,
    editor: null,
    drafts: [],
    setActive() {},
    setEditor() {},
    begin() {},
    resolve() {},
  } as unknown as Comments;
  const html = renderToStaticMarkup(
    <CommentContext.Provider value={comments}>
      <ThreadView thread={agentThread} />
    </CommentContext.Provider>,
  );
  assert.match(html, /Build agent/);
  assert.match(html, />Agent</);
  assert.doesNotMatch(html, /Edit comment/);
  assert.match(exportThread(agentThread), /Comment by Build agent · Agent/);
});
test("copied agent requests identify the review, round, worktree, and permission", () => {
  const identity = {
    id: "review-1",
    binding: { worktree: "/repo/worktree" },
  } as ReviewIdentity;
  const submission = { number: 3 } as Submission;
  assert.match(agentRequest(identity, submission, "address"), /review `review-1`/);
  assert.match(agentRequest(identity, submission, "address"), /Reply to each thread/);
  assert.match(agentRequest(identity, submission, "summarize"), /Do not change code/);
  assert.match(agentRequest(identity, submission, "summarize"), /submission 3/);
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
