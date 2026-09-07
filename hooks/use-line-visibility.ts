import { useEffect, type RefObject } from "react";
import { addCoverage, coverageComplete } from "@/lib/diff/viewed.mjs";
/** Overscan is not visibility. Sample only real code rows after a short dwell.
 * Partial coverage handles wrapped rows taller than the viewport. */
export function useLineVisibility(
  root: RefObject<HTMLDivElement | null>,
  markSeen: (file: number, hunk: number, rows: number[]) => void,
  layoutKey: string,
) {
  useEffect(() => {
    const candidates = new Map<string, { since: number; start: number; end: number }>();
    const coverage = new Map<string, number[][]>();
    const complete = new Set<string>();
    const sample = () => {
      const viewport = root.current;
      if (!viewport || document.visibilityState !== "visible") {
        candidates.clear();
        return;
      }
      const view = viewport.getBoundingClientRect();
      if (!view.height || !view.width) return;
      const topElement = document.elementFromPoint(
        view.left + view.width / 2,
        view.top + Math.min(60, view.height / 2),
      );
      if (!topElement || !viewport.contains(topElement)) {
        candidates.clear();
        return;
      }
      // A clipped host iframe does not prove that both panes were seen.
      try {
        const frame = window.frameElement;
        if (frame) {
          const r = frame.getBoundingClientRect();
          if (
            r.left < 0 ||
            r.top < 0 ||
            r.right > window.parent.innerWidth + 1 ||
            r.bottom > window.parent.innerHeight + 1
          ) {
            candidates.clear();
            return;
          }
        }
      } catch {
        /* Cross-origin hosts control their own viewport. */
      }

      const now = performance.now();
      const visible = new Set<string>();
      viewport.querySelectorAll<HTMLElement>("[data-review-line]").forEach((row) => {
        const key = row.dataset.reviewLine!;
        if (complete.has(key)) return;
        const r = row.getBoundingClientRect();
        const top = Math.max(r.top, view.top),
          bottom = Math.min(r.bottom, view.bottom);
        if (bottom <= top || r.height <= 0 || r.right <= view.left || r.left >= view.right) return;
        visible.add(key);
        const start = (top - r.top) / r.height,
          end = (bottom - r.top) / r.height;
        const prior = candidates.get(key);
        if (!prior) {
          candidates.set(key, { since: now, start, end });
          return;
        }
        // Only the portion that stayed visible for the dwell period counts.
        const stableStart = Math.max(start, prior.start),
          stableEnd = Math.min(end, prior.end);
        if (stableEnd <= stableStart) {
          candidates.set(key, { since: now, start, end });
          return;
        }
        if (now - prior.since >= 300) {
          const ranges = addCoverage(coverage.get(key) || [], stableStart, stableEnd);
          coverage.set(key, ranges);
          candidates.set(key, { since: now, start, end });
          if (coverageComplete(ranges)) {
            complete.add(key);
            coverage.delete(key);
            const [file, hunk, indices] = key.split("/");
            markSeen(+file, +hunk, indices.split(",").map(Number));
          }
        }
      });
      for (const k of candidates.keys()) if (!visible.has(k)) candidates.delete(k);
    };
    const timer = setInterval(sample, 120);
    return () => clearInterval(timer);
  }, [root, markSeen, layoutKey]);
}
