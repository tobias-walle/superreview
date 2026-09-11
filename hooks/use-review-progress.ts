import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FileMeta, ReviewData } from "@/lib/diff/render";
import { checkpointMatches, canMarkAutomatically } from "@/lib/review/checkpoints";
import { useReviewSession } from "./use-review-session";
export type Decisions = Record<string, { viewed: boolean; manual: boolean }>;
export function useReviewProgress(data: ReviewData, meta: FileMeta[]) {
  const runtime = useReviewSession();
  const snapshot = runtime.session!.snapshot;
  const seen = useRef(new Map<number, Set<string>>());
  const completed = useRef(new Set<number>());
  useEffect(() => {
    seen.current.clear();
    completed.current.clear();
  }, [snapshot.id]);
  const totals = useMemo(
    () => meta.map((m) => m.hunks.reduce((n, h) => n + h.sourceCount, 0)),
    [meta],
  );
  const records = runtime.session!.state.checkpoints;
  const matching = meta.map((m, i) => {
    const cp = records[data.files[i].path],
      evidence = snapshot.evidence[data.files[i].path];
    return checkpointMatches(cp, evidence, m.fingerprint) ? cp : undefined;
  });
  const persist = useCallback(
    (file: number, viewed: boolean, manual: boolean) => {
      const snapshot = runtime.session!.snapshot,
        m = meta[file],
        path = data.files[file]?.path;
      if (
        !m ||
        !path ||
        runtime.session!.state.archived ||
        snapshot.id !== runtime.session!.state.snapshotId
      )
        return;
      const checkpoint = {
        path,
        fingerprint: m.fingerprint,
        viewed,
        manual,
        snapshotId: snapshot.id,
        evidence: snapshot.evidence[path],
        created: Date.now(),
      };
      void runtime.execute({ type: "checkpoint", checkpoint }).catch(() => {
        completed.current.delete(file);
      });
    },
    [runtime, meta, data.files],
  );
  const markTraversed = useCallback(
    (file: number) => {
      if (completed.current.has(file) || !totals[file]) return;
      const cp = runtime.session!.state.checkpoints[data.files[file].path];
      const evidence = runtime.session!.snapshot.evidence[data.files[file].path];
      if (!canMarkAutomatically(cp, evidence, meta[file].fingerprint)) return;
      completed.current.add(file);
      seen.current.delete(file);
      persist(file, true, false);
    },
    [runtime, data.files, meta, totals, persist],
  );
  const markSeen = useCallback(
    (file: number, hunk: number, indices: number[]) => {
      if (completed.current.has(file) || !totals[file]) return;
      const cp = runtime.session!.state.checkpoints[data.files[file].path];
      const evidence = runtime.session!.snapshot.evidence[data.files[file].path];
      if (!canMarkAutomatically(cp, evidence, meta[file].fingerprint)) return;
      let set = seen.current.get(file);
      if (!set) {
        set = new Set();
        seen.current.set(file, set);
      }
      indices.forEach((i) => set!.add(`${hunk}:${i}`));
      if (set.size >= totals[file]) {
        completed.current.add(file);
        seen.current.delete(file);
        persist(file, true, false);
      }
    },
    [runtime, meta, totals, persist, data.files],
  );
  return {
    viewed: matching.map((cp) => !!cp?.viewed),
    manual: matching.map((cp) => !!cp?.manual),
    toggle: (file: number, value: boolean) => persist(file, value, true),
    resume: (file: number) => {
      completed.current.delete(file);
      persist(file, false, false);
    },
    markSeen,
    markTraversed,
  };
}
