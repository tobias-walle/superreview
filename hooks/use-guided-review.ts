import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Anchor } from "../lib/comments/model";
import { buildFileTreeEntries } from "../lib/diff/file-order";
import type { ReviewFile } from "../lib/diff/render";
import { buildDiffScope, scopeContainsAnchor } from "../lib/diff/scoped-blocks";
import type { ResolvedGuideTarget } from "../lib/review/guide";
import type { Command, ReviewClient, ReviewState, Snapshot } from "../lib/review/types";

export type LoadedGuide = Awaited<ReturnType<ReviewClient["guide"]>>;
type GuideDescriptor = ReviewState["guides"][number];
export type GuideChunk = LoadedGuide["bundle"]["manifest"]["chunks"][number];
export type GuideTarget = GuideChunk["targets"][number];

function checkOpeningGuide(guide: LoadedGuide, descriptor: GuideDescriptor, snapshotId: string) {
  if (guide.id !== descriptor.id || guide.snapshotId !== snapshotId) {
    throw new Error("Guide does not match its published snapshot.");
  }
  const { manifest, documents } = guide.bundle;
  if (manifest.snapshotId !== snapshotId || manifest.schema !== 1 || !manifest.chunks.length) {
    throw new Error("Invalid guide manifest for this snapshot.");
  }
  for (const chunk of manifest.chunks) {
    if (
      !chunk.targets.length ||
      !Object.hasOwn(documents, chunk.content) ||
      !documents[chunk.content].trim()
    ) {
      throw new Error("Guide explanation is unavailable.");
    }
    for (const target of chunk.targets) {
      if (!guide.resolvedTargets || !Object.hasOwn(guide.resolvedTargets, target.id)) {
        throw new Error("Validated guide target is unavailable.");
      }
    }
  }
}

/** Publication order, not authored timestamps, chooses the opening revision. */
export async function selectOpeningGuide(
  snapshotId: string,
  descriptors: readonly GuideDescriptor[],
  load: (id: string) => Promise<LoadedGuide>,
) {
  const errors: string[] = [];
  for (const descriptor of [...descriptors].reverse()) {
    if (descriptor.snapshotId !== snapshotId) continue;
    try {
      const guide = await load(descriptor.id);
      checkOpeningGuide(guide, descriptor, snapshotId);
      return { guide, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Guide ${descriptor.id} unavailable: ${message}`);
    }
  }
  return { guide: null, errors };
}

/** Build with the original array so scoped folder grouping never renumbers files. */
export function guidedFileOrder(files: readonly ReviewFile[], targets?: readonly GuideTarget[]) {
  const paths = targets ? new Set(targets.map((target) => target.path)) : null;
  const entries = buildFileTreeEntries(
    files.map((file) => file.path),
    new Set(),
    (file) => {
      if (!paths) return true;
      return paths.has(files[file].path);
    },
  );
  return entries.flatMap((entry) => (entry.kind === "file" ? [entry.file] : []));
}

/** Validated coordinates need no worker metadata and never consult current code. */
export function guideTargetAnchor(
  snapshotId: string,
  resolved: ResolvedGuideTarget,
): Anchor | null {
  const target = resolved.target;
  let range = resolved.ranges[0];
  if (target.kind === "file") {
    range = resolved.ranges.find((candidate) => candidate.side === "new") || range;
  }
  // A source-only range has no displayed hunk. The caller must offer full source.
  if (!range && target.kind === "range") return null;
  const start = range?.start || { hunk: 0, source: 0, line: 0, text: "" };
  return {
    kind: target.kind === "file" ? "file" : "line",
    snapshotId,
    path: target.path,
    fingerprint: resolved.fingerprint,
    side: range?.side || "new",
    start,
    end: target.kind === "file" ? start : resolved.ranges.at(-1)!.end,
    excerpt: start.text,
  };
}

export function guideTargetChunk(
  guide: LoadedGuide,
  files: readonly ReviewFile[],
  targetId: string,
  anchor: Anchor,
) {
  if (!Object.hasOwn(guide.resolvedTargets, targetId)) return null;
  const resolved = guide.resolvedTargets[targetId];
  for (const chunk of guide.bundle.manifest.chunks) {
    if (!chunk.targets.some((target) => target.id === targetId)) continue;
    const scope = buildDiffScope(files, chunk.targets);
    if (scopeContainsAnchor(scope, resolved.fileIndex, files[resolved.fileIndex], anchor))
      return chunk.id;
  }
  return null;
}

export type GuideSelection = {
  snapshotId: string;
  opened: boolean;
  guide: LoadedGuide | null;
  chunkId: string | null;
  humanChoice: boolean;
  errors: string[];
  publications: string[];
};
export const EMPTY_GUIDE_SELECTION: GuideSelection = {
  snapshotId: "",
  opened: false,
  guide: null,
  chunkId: null,
  humanChoice: false,
  errors: [],
  publications: [],
};
type SelectionAction =
  | { type: "opening"; snapshotId: string }
  | {
      type: "opened";
      snapshotId: string;
      guide: LoadedGuide | null;
      errors: string[];
      publications: string[];
    }
  | { type: "choose"; snapshotId: string; chunkId: string | null };

export function guideSelection(state: GuideSelection, action: SelectionAction): GuideSelection {
  if (action.type === "opening") {
    return { ...EMPTY_GUIDE_SELECTION, snapshotId: action.snapshotId };
  }
  const sameSnapshot = state.snapshotId === action.snapshotId;
  if (action.type === "choose") {
    const current = sameSnapshot ? state : EMPTY_GUIDE_SELECTION;
    return {
      ...current,
      snapshotId: action.snapshotId,
      chunkId: action.chunkId,
      humanChoice: true,
    };
  }
  let chunkId = action.guide?.bundle.manifest.chunks[0]?.id || null;
  if (sameSnapshot && state.humanChoice) chunkId = state.chunkId;
  return {
    snapshotId: action.snapshotId,
    opened: true,
    guide: action.guide,
    errors: action.errors,
    publications: action.publications,
    chunkId,
    humanChoice: sameSnapshot && state.humanChoice,
  };
}

export function useGuidedReview({
  snapshot,
  state,
  load,
  execute,
}: {
  snapshot: Snapshot;
  state: ReviewState;
  load: (id: string) => Promise<LoadedGuide>;
  execute: (command: Command) => Promise<ReviewState>;
}) {
  const [selection, dispatch] = useReducer(guideSelection, EMPTY_GUIDE_SELECTION);
  // Reset by snapshot identity before async opening. Even a quick historical visit
  // must not carry the previous opening's human choice back to this snapshot.
  if (selection.snapshotId !== snapshot.id) dispatch({ type: "opening", snapshotId: snapshot.id });
  const [write, setWrite] = useState({ guideId: "", pending: false, error: "" });
  const openingInputs = useRef({ state, load });
  useEffect(() => {
    openingInputs.current = { state, load };
  });
  useEffect(() => {
    let active = true;
    const { state, load } = openingInputs.current;
    const descriptors = state.guides;
    const publications = descriptors
      .filter((guide) => guide.snapshotId === snapshot.id)
      .map((guide) => guide.id);
    void selectOpeningGuide(snapshot.id, descriptors, load).then(({ guide, errors }) => {
      if (active)
        dispatch({ type: "opened", snapshotId: snapshot.id, guide, errors, publications });
    });
    return () => {
      active = false;
    };
  }, [snapshot.id]);

  const matchesSnapshot = selection.snapshotId === snapshot.id;
  const guide = matchesSnapshot ? selection.guide : null;
  const chunk = guide?.bundle.manifest.chunks.find(
    (candidate) => candidate.id === selection.chunkId,
  );
  const scope = useMemo(() => {
    if (!chunk) return undefined;
    return buildDiffScope(snapshot.data.files, chunk.targets);
  }, [snapshot.data.files, chunk]);
  const fileOrder = useMemo(
    () => guidedFileOrder(snapshot.data.files, chunk?.targets),
    [snapshot.data.files, chunk],
  );
  const newerAvailable =
    matchesSnapshot &&
    selection.opened &&
    state.guides.some((descriptor) => {
      return (
        descriptor.snapshotId === snapshot.id && !selection.publications.includes(descriptor.id)
      );
    });
  const previousGuide = [...state.guides]
    .reverse()
    .find((descriptor) => descriptor.snapshotId !== snapshot.id);
  const reads = guide ? state.guideReads[guide.id] || {} : {};
  const errors = matchesSnapshot ? [...selection.errors] : [];
  if (guide && write.guideId === guide.id && write.error) errors.push(write.error);

  async function setRead(chunkId: string, read: boolean) {
    if (
      !guide ||
      !guide.bundle.manifest.chunks.some((candidate) => candidate.id === chunkId) ||
      write.pending ||
      state.archived
    )
      return;
    setWrite({ guideId: guide.id, pending: true, error: "" });
    try {
      await execute({ type: "guide-read", guideId: guide.id, chunkId, read });
      setWrite({ guideId: guide.id, pending: false, error: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWrite({ guideId: guide.id, pending: false, error: message });
    }
  }
  function selectChunk(chunkId: string | null, snapshotId = snapshot.id) {
    dispatch({ type: "choose", snapshotId, chunkId });
  }
  return {
    guide,
    chunk,
    scope,
    fileOrder,
    errors,
    newerAvailable,
    previousGuide,
    reads,
    loading: !matchesSnapshot || !selection.opened,
    setRead,
    selectChunk,
    readPending: write.pending,
  };
}
