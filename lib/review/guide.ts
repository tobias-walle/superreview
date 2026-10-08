import type { Author, Point, Side } from "../comments/model";
import type { ComparisonSpec, Evidence, Snapshot } from "./types";

/** Schema 1 authoring data contains no author, read state or claimed fingerprints. */
export type GuideTarget =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "range"; path: string; side: Side; start: number; end: number };
export type GuideChunk = {
  id: string;
  title: string;
  kind?: "remaining";
  content: string;
  targets: GuideTarget[];
};
export type GuideManifest = { schema: 1; snapshotId: string; chunks: GuideChunk[] };
export type GuideBundle = { manifest: GuideManifest; documents: Record<string, string> };
export type GuideDescriptor = {
  id: string;
  snapshotId: string;
  created: number;
  /** Supplied by the trusted publication boundary, never by the manifest. */
  author: Author;
  /** Immutable artifact integrity and exact request identity. */
  artifactHash: string;
  requestHash: string;
  snapshotHash: string;
  chunkIds: string[];
};
/** Coordinates refer to the original snapshot, not a chunk-local diff model. */
export type ResolvedGuideTarget = {
  target: GuideTarget;
  fileIndex: number;
  fingerprint: string;
  sourceObjects: { old: string | null; new: string | null };
  ranges: { side: Side; start: Point; end: Point }[];
};
export type PublishedGuide = GuideDescriptor & {
  bundle: GuideBundle;
  resolvedTargets: Record<string, ResolvedGuideTarget>;
};
export type GuideReads = Record<string, Record<string, boolean>>;

/** Inclusive intervals. Inventory size follows changed runs, not changed line count. */
export type GuideInterval = { start: number; end: number };
export type GuideFileMarker = "added" | "deleted" | "mode" | "binary" | "submodule" | "non-text";
export type GuideFileInventory = {
  path: string;
  fileIndex: number;
  fingerprint?: string;
  evidence: Evidence;
  old: GuideInterval[];
  new: GuideInterval[];
  markers: GuideFileMarker[];
};
export type GuideInventory = { snapshotId: string; files: GuideFileInventory[] };
export type CapturedGuideSource = {
  object: string | null;
  mode: string;
  encoding: "utf8" | "base64";
  content: string | null;
  /** Null for binary data. A missing file has zero lines. */
  lineCount: number | null;
};
export type GuideInspection = {
  reviewId: string;
  snapshotId: string;
  captureView: Snapshot["captureView"] | null;
  comparison: ComparisonSpec | null;
  /** Exact saved diff and evidence, never recaptured worktree data. */
  snapshot: Snapshot;
  inventory: GuideInventory;
  sources: { path: string; old: CapturedGuideSource; new: CapturedGuideSource }[];
};
