import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  comparePoints,
  type Anchor,
  type Author,
  type Message,
  type Point,
  type Thread,
} from "../lib/comments/model";
import { renderHunk } from "../lib/diff/render";
import { pendingThreads, revision } from "../lib/review/core";
import type { Command, ReviewState, Session, Snapshot, Submission } from "../lib/review/types";
import { JsonlStore, lockRepository } from "../adapters/node/jsonl-store";

export type WriteContext = {
  state: ReviewState;
  snapshot: Snapshot;
  snapshotById(id: string): Promise<Snapshot>;
};

export function agentAuthor(name: string): Author {
  const clean = name.trim();
  if (!clean) throw new Error("Agent author must not be empty");
  if (clean.length > 200) throw new Error("Agent author is too long");
  return {
    id: `agent-${createHash("sha256").update(clean).digest("hex").slice(0, 16)}`,
    name: clean,
    kind: "agent",
  };
}

export async function commentBody(body: string, bodyFile: string) {
  if (body && bodyFile) throw new Error("Use --body or --body-file, not both");
  let value = body;
  if (bodyFile === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    value = Buffer.concat(chunks).toString("utf8");
  } else if (bodyFile) value = await readFile(bodyFile, "utf8");
  value = value.trim();
  if (!value) throw new Error("Supply comment text with --body or --body-file");
  if (value.length > 30000) throw new Error("Comment text is too long");
  return value;
}

function pointAt(snapshot: Snapshot, path: string, side: "old" | "new", number: number): Point {
  const file = snapshot.data.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`File is not in snapshot: ${path}`);
  for (let hunk = 0; hunk < file.hunks.length; hunk++) {
    for (const line of renderHunk(file.hunks[hunk]).unified) {
      if ((side === "old" ? line.oldNo : line.newNo) === number)
        return { hunk, source: line.sourceIndex, line: number, text: line.text };
    }
  }
  throw new Error(`${side === "old" ? "Old" : "New"} line ${number} is not in the diff`);
}

export function commentAnchor(options: {
  snapshot: Snapshot;
  path: string;
  side: "old" | "new";
  line: number;
  endLine: number;
  fileComment: boolean;
}): Anchor {
  const { snapshot, path, side, fileComment } = options;
  const file = snapshot.data.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`File is not in snapshot: ${path}`);
  if (!file.fingerprint) throw new Error("The captured file has no content fingerprint");
  if (fileComment)
    return {
      kind: "file",
      snapshotId: snapshot.id,
      path,
      fingerprint: file.fingerprint,
      side,
      start: { hunk: 0, source: 0, line: 0, text: "" },
      end: { hunk: 0, source: 0, line: 0, text: "" },
      excerpt: file.changeSummary || "",
    };
  if (!Number.isInteger(options.line) || options.line < 1)
    throw new Error("Line comments require --line <number>");
  const start = pointAt(snapshot, path, side, options.line);
  const end = pointAt(snapshot, path, side, options.endLine || options.line);
  if (comparePoints(start, end) > 0) throw new Error("The end line must follow the start line");
  const excerpt: string[] = [];
  for (let hunk = start.hunk; hunk <= end.hunk; hunk++) {
    for (const line of renderHunk(file.hunks[hunk]).unified) {
      const current = { hunk, source: line.sourceIndex, line: 0, text: line.text };
      const number = side === "old" ? line.oldNo : line.newNo;
      if (
        number !== undefined &&
        comparePoints(current, start) >= 0 &&
        comparePoints(current, end) <= 0
      )
        excerpt.push(`${number}: ${line.text}`);
    }
  }
  return {
    kind: "line",
    snapshotId: snapshot.id,
    path,
    fingerprint: file.fingerprint,
    side,
    start,
    end,
    excerpt: excerpt.join("\n").slice(0, 20000),
  };
}

function changedMessages(previous: Thread | undefined, current: Thread) {
  const before = new Map(previous?.messages.map((message) => [message.id, message]));
  return current.messages
    .filter((message) => JSON.stringify(before.get(message.id)) !== JSON.stringify(message))
    .map((message) => message.id);
}

function submissionChanges(submissions: Submission[]) {
  const previous = new Map<string, Thread>();
  const changes = new Map<
    string,
    { submission: number; messageIds: string[]; resolutionChanged: boolean }[]
  >();
  for (const submission of submissions) {
    for (const thread of submission.threads) {
      const prior = previous.get(thread.id);
      changes.set(thread.id, [
        ...(changes.get(thread.id) || []),
        {
          submission: submission.number,
          messageIds: changedMessages(prior, thread),
          resolutionChanged: !!prior && !!prior.resolved !== !!thread.resolved,
        },
      ]);
      previous.set(thread.id, thread);
    }
  }
  return changes;
}

export function threadOutput(state: ReviewState, submission = 0, draftCount = 0) {
  const changes = submissionChanges(state.submissions);
  const selected = submission
    ? new Set(
        state.submissions
          .find((entry) => entry.number === submission)
          ?.threads.map((thread) => thread.id) || [],
      )
    : null;
  if (submission && !state.submissions.some((entry) => entry.number === submission))
    throw new Error("No matching submission");
  const pending = new Set(pendingThreads(state).map((thread) => thread.id));
  return {
    reviewId: state.identity.id,
    title: state.identity.title,
    sequence: state.sequence,
    snapshotId: state.snapshotId,
    archived: state.archived,
    draftCount,
    submissions: state.submissions.map((entry) => ({
      number: entry.number,
      id: entry.id,
      created: entry.created,
      snapshotId: entry.snapshotId,
      summary: entry.summary,
      threadIds: entry.threads.map((thread) => thread.id),
    })),
    threads: state.threads
      .filter((thread) => !selected || selected.has(thread.id))
      .map((thread) => ({
        ...thread,
        pending: pending.has(thread.id),
        revision: revision(thread),
        submissionChanges: changes.get(thread.id) || [],
      })),
  };
}

async function activeServer(root: string) {
  try {
    const value = JSON.parse(await readFile(join(root, "writer.lock", "server.json"), "utf8"));
    if (typeof value.url === "string" && typeof value.reviewId === "string") return value;
  } catch {}
  return null;
}

async function serverRequest<T>(url: string, path: string, value?: unknown): Promise<T> {
  const response = await fetch(
    `${url}/api/${path}`,
    value === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "content-type": "application/json", "x-superreview": "1" },
          body: JSON.stringify(value),
        },
  );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not update review");
  return result;
}

export async function executeReviewWrite(options: {
  root: string;
  reviewId: string;
  expectedSequence: number;
  requestId?: string;
  command(context: WriteContext, requestId: string): Promise<Command> | Command;
}) {
  const requestId = options.requestId || randomUUID();
  const active = await activeServer(options.root);
  if (active?.reviewId === options.reviewId) {
    try {
      const session = await serverRequest<Session>(active.url, "session");
      if (session.status !== "ready")
        throw new Error(
          session.status === "error" ? session.error : "Review capture is still in progress",
        );
      const command = await options.command(
        {
          state: session.state,
          snapshot: session.snapshot,
          snapshotById: (id) => serverRequest(active.url, `snapshots/${encodeURIComponent(id)}`),
        },
        requestId,
      );
      const state = await serverRequest<ReviewState>(active.url, "commands", {
        command,
        sequence: options.expectedSequence || session.state.sequence,
        id: requestId,
      });
      return { state, requestId };
    } catch (error: any) {
      if (!String(error.cause?.code || error.message).includes("fetch failed")) throw error;
    }
  }
  const unlock = await lockRepository(options.root);
  try {
    const store = new JsonlStore(options.root, options.reviewId);
    await store.load(true);
    const snapshot = await store.snapshot(store.state.snapshotId);
    const command = await options.command(
      {
        state: store.state,
        snapshot,
        snapshotById: (id) => store.snapshot(id),
      },
      requestId,
    );
    const state = await store.execute(
      command,
      options.expectedSequence || store.state.sequence,
      requestId,
    );
    return { state, requestId };
  } finally {
    await unlock();
  }
}

export function replyCommand(
  thread: Thread,
  body: string,
  author: Author,
  requestId: string,
): Command {
  if (thread.messages.some((message) => message.id === requestId))
    return { type: "thread", thread };
  const message: Message = { id: requestId, body, author, created: Date.now() };
  return { type: "thread", thread: { ...thread, messages: [...thread.messages, message] } };
}
