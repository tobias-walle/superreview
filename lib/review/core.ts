import type { Thread } from "../comments/model";
import type { Command, Event, ReviewIdentity, ReviewState, Snapshot, Submission } from "./types";
import { exportSubmission } from "./markdown";

export function emptyReview(identity: ReviewIdentity): ReviewState {
  return {
    identity,
    sequence: 0,
    archived: false,
    snapshotId: "",
    threads: [],
    checkpoints: {},
    submissions: [],
    guides: [],
    guideReads: {},
  };
}
export function revision(thread: Thread): string {
  return JSON.stringify([thread.anchor, thread.messages, !!thread.resolved]);
}
export function pendingThreads(state: ReviewState): Thread[] {
  const submitted = Object.assign({}, ...state.submissions.map((s) => s.revisions));
  return state.threads.filter(
    (t) =>
      submitted[t.id] !== revision(t) && (submitted[t.id] || t.messages.some((m) => !m.deleted)),
  );
}
export function evolve(state: ReviewState, event: Event): ReviewState {
  if (event.schema !== 1 || event.sequence !== state.sequence + 1)
    throw new Error("Invalid event sequence or schema");
  const next = { ...state, sequence: event.sequence };
  switch (event.type) {
    case "thread":
      return {
        ...next,
        threads: [...state.threads.filter((t) => t.id !== event.thread.id), event.thread],
      };
    case "checkpoint":
      return {
        ...next,
        checkpoints: {
          ...state.checkpoints,
          [event.checkpoint.path]: event.checkpoint,
        },
      };
    case "submission":
      return { ...next, submissions: [...state.submissions, event.submission] };
    case "snapshot":
      return { ...next, snapshotId: event.snapshotId };
    case "archive":
      return { ...next, archived: event.archived };
    case "guide-published": {
      if (state.guides.some((guide) => guide.id === event.guide.id))
        throw new Error("Guide revision is already published");
      if (event.guide.author.kind !== "agent") throw new Error("Guide author must be an agent");
      return {
        ...next,
        guides: [...state.guides, event.guide],
        guideReads: {
          ...state.guideReads,
          [event.guide.id]: Object.fromEntries(event.guide.chunkIds.map((id) => [id, false])),
        },
      };
    }
    case "guide-read": {
      const guide = state.guides.find((guide) => guide.id === event.guideId);
      if (
        !guide ||
        guide.snapshotId !== event.snapshotId ||
        !guide.chunkIds.includes(event.chunkId)
      )
        throw new Error("Read confirmation does not match a published guide chunk");
      return {
        ...next,
        guideReads: {
          ...state.guideReads,
          [guide.id]: { ...state.guideReads[guide.id], [event.chunkId]: event.read },
        },
      };
    }
    default:
      throw new Error("Unknown event type");
  }
}
/** Decide once, then persist the complete event. Replay never calls a clock or Git. */
export function decide(
  state: ReviewState,
  command: Command,
  snapshot: Snapshot | undefined,
  id: string,
  now: number,
): Event {
  if (state.archived && command.type !== "archive")
    throw new Error("This review is archived. Reopen it before adding feedback.");
  const envelope = {
    schema: 1 as const,
    id,
    sequence: state.sequence + 1,
    created: now,
  };
  if (command.type === "guide-read") {
    const guide = state.guides.find((guide) => guide.id === command.guideId);
    if (!guide) throw new Error("Guide revision is not published in this review");
    if (!guide.chunkIds.includes(command.chunkId)) throw new Error("Unknown guide chunk");
    return { ...envelope, ...command, snapshotId: guide.snapshotId };
  }
  if (command.type !== "submit") return { ...envelope, ...structuredClone(command) };
  if (!snapshot) throw new Error("Capture a snapshot before submitting.");
  const threads = structuredClone(pendingThreads(state));
  if (!threads.length && !command.summary.trim())
    throw new Error("Add feedback or a summary before submitting.");
  const submission: Submission = {
    id,
    number: state.submissions.length + 1,
    created: now,
    snapshotId: snapshot.id,
    summary: command.summary.trim(),
    threads,
    revisions: Object.fromEntries(threads.map((t) => [t.id, revision(t)])),
    markdown: "",
  };
  submission.markdown = exportSubmission(state.identity, snapshot, submission);
  return { ...envelope, type: "submission", submission };
}
