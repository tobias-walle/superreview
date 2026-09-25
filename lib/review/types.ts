import type { Draft, Thread } from "../comments/model";
import type { ReviewData } from "../diff/render";

export type FileVersion = { object: string | null; mode: string };
export type Evidence = { before: FileVersion; after: FileVersion; key: string };
export type CaptureProgress = {
  phase: "discovering" | "capturing" | "diffing" | "saving";
  completed: number;
  total: number;
};
export type ComparisonSpec = {
  refs: string[];
  paths: string[];
  cached: boolean;
  unstaged?: boolean;
};
export type Snapshot = {
  comparison?: ComparisonSpec;
  id: string;
  created: number;
  label: string;
  base: string;
  target: string;
  data: ReviewData;
  evidence: Record<string, Evidence>;
};
export type ReviewIdentity = {
  schema: 1;
  id: string;
  title: string;
  created: number;
  binding: {
    repository: string;
    worktree: string;
    branch: string;
    comparison?: string;
    target?: string;
  };
  remote?: {
    provider: "github" | "gitlab";
    repository: string;
    request: string;
  };
};
export type Checkpoint = {
  path: string;
  fingerprint: string;
  viewed: boolean;
  manual: boolean;
  snapshotId: string;
  evidence?: Evidence;
  created: number;
};
export type Submission = {
  id: string;
  number: number;
  created: number;
  snapshotId: string;
  summary: string;
  threads: Thread[];
  revisions: Record<string, string>;
  markdown: string;
};
export type ReviewState = {
  identity: ReviewIdentity;
  sequence: number;
  archived: boolean;
  snapshotId: string;
  threads: Thread[];
  checkpoints: Record<string, Checkpoint>;
  submissions: Submission[];
};
export type Command =
  | { type: "thread"; thread: Thread }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "submit"; summary: string }
  | { type: "archive"; archived: boolean };
export type Event = {
  schema: 1;
  id: string;
  sequence: number;
  created: number;
} & (
  | { type: "thread"; thread: Thread }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "submission"; submission: Submission }
  | { type: "snapshot"; snapshotId: string }
  | { type: "archive"; archived: boolean }
);
type SessionBase = {
  state: ReviewState;
  drafts: Draft[];
  draftRevision: number;
};
export type ReadySession = SessionBase & {
  status: "ready";
  snapshot: Snapshot;
};
export type Session =
  | ReadySession
  | (SessionBase & {
      status: "capturing";
      progress: CaptureProgress;
    })
  | (SessionBase & {
      status: "error";
      error: string;
    });
/** The UI talks to one port. Persistence and transport stay outside React. */
export interface ReviewClient {
  load(): Promise<Session>;
  execute(command: Command, sequence: number, id: string): Promise<ReviewState>;
  saveDrafts(drafts: Draft[], revision: number): Promise<number>;
  refresh(view: "full" | "since"): Promise<Session>;
  snapshot(id: string): Promise<Snapshot>;
  content(object: string): Promise<string>;
}
