import { useEffect, useRef, type RefObject } from "react";
import { addCoverage, coverageComplete } from "@/lib/diff/viewed.mjs";
/** Overscan is not visibility. Sample only code rows intersecting the real viewport.
 * Partial coverage handles wrapped rows taller than the viewport. */
export function useLineVisibility(
  root: RefObject<HTMLDivElement | null>,
  markSeen: (file: number, hunk: number, rows: number[]) => void,
  layoutKey: string,
) {
  const markSeenRef = useRef(markSeen);
  useEffect(() => {
    markSeenRef.current = markSeen;
  }, [markSeen]);
  useEffect(() => {
    const coverage = new Map<string, number[][]>();
    const complete = new Set<string>();
    const sample = () => {
      const viewport = root.current;
      if (!viewport || document.visibilityState !== "visible") return;
      const view = viewport.getBoundingClientRect();
      if (!view.height || !view.width) return;
      const stickyHeader = viewport.querySelector<HTMLElement>(".sticky-file-header");
      const visibleTop = Math.max(
        view.top,
        stickyHeader?.getBoundingClientRect().bottom || view.top,
      );
      const topElement = document.elementFromPoint(
        view.left + view.width / 2,
        view.top + Math.min(60, view.height / 2),
      );
      if (!topElement || !viewport.contains(topElement)) return;
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
          )
            return;
        }
      } catch {
        /* Cross-origin hosts control their own viewport. */
      }

      viewport.querySelectorAll<HTMLElement>("[data-review-line]").forEach((row) => {
        const key = row.dataset.reviewLine!;
        if (complete.has(key)) return;
        const r = row.getBoundingClientRect();
        const top = Math.max(r.top, visibleTop),
          bottom = Math.min(r.bottom, view.bottom);
        if (bottom <= top || r.height <= 0 || r.right <= view.left || r.left >= view.right) return;
        const start = (top - r.top) / r.height,
          end = (bottom - r.top) / r.height;
        const ranges = addCoverage(coverage.get(key) || [], start, end);
        coverage.set(key, ranges);
        if (coverageComplete(ranges)) {
          complete.add(key);
          coverage.delete(key);
          const [file, hunk, indices] = key.split("/");
          markSeenRef.current(+file, +hunk, indices.split(",").map(Number));
        }
      });
    };
    let sampleTimer: ReturnType<typeof setTimeout> | undefined;
    const sampleAfterLayout = () => {
      if (sampleTimer !== undefined) return;
      sampleTimer = setTimeout(() => {
        sampleTimer = undefined;
        sample();
      }, 0);
    };
    const viewport = root.current;
    const renderedRows = new MutationObserver(sampleAfterLayout);
    const resized = new ResizeObserver(sampleAfterLayout);
    if (viewport) {
      renderedRows.observe(viewport, { childList: true, subtree: true });
      resized.observe(viewport);
    }
    viewport?.addEventListener("scroll", sampleAfterLayout, { passive: true });
    document.addEventListener("visibilitychange", sampleAfterLayout);
    sample();
    sampleAfterLayout();
    return () => {
      viewport?.removeEventListener("scroll", sampleAfterLayout);
      document.removeEventListener("visibilitychange", sampleAfterLayout);
      renderedRows.disconnect();
      resized.disconnect();
      if (sampleTimer !== undefined) clearTimeout(sampleTimer);
    };
  }, [root, layoutKey]);
}
