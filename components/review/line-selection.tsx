import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { useComments } from "@/hooks/use-comments";
import { contains, label, point, range, type Anchor, type Side } from "@/lib/comments/model";
import type { DiffLine } from "@/lib/diff/render";

// Ignore small mouse jitter so a click does not accidentally become a range drag.
const DRAG_THRESHOLD_PX = 4;

export function Gutter({
  line,
  side,
  file,
  hunk,
  plus = false,
}: {
  line: DiffLine;
  side: Side;
  file: number;
  hunk: number;
  plus?: boolean;
}) {
  const c = useComments();
  const path = c.data.files[file].path;
  const p = point(line, hunk, side);
  const moved = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const a: Anchor = {
    path,
    fingerprint: c.meta[file].fingerprint,
    side,
    start: p,
    end: p,
    excerpt: p.text,
  };
  const draft = c.drafts.find((d) => d.id === c.editor && !d.threadId && !d.messageId);
  const selected = draft && contains(draft.anchor, path, hunk, line, side);
  const title =
    plus && selected
      ? `Continue comment on ${label(draft.anchor)}`
      : "Comment on line · Shift-click to adjust range";
  return (
    <button
      className={plus ? "line-comment-add" : "line-no line-target"}
      aria-label={plus ? `Comment on ${side} line ${p.line}` : `Select ${side} line ${p.line}`}
      title={title}
      data-gutter-file={file}
      data-gutter-hunk={hunk}
      data-gutter-source={p.source}
      data-gutter-side={side}
      data-gutter-line={p.line}
      onPointerDown={(e) => {
        moved.current = false;
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        cleanup.current?.();
        const origin = (e.shiftKey && c.selectionBase(a)) || a;
        const extend = e.shiftKey;
        const startX = e.clientX,
          startY = e.clientY;
        let next: Anchor | null = null;
        const move = (event: PointerEvent) => {
          if (
            Math.abs(event.clientY - startY) + Math.abs(event.clientX - startX) <
            DRAG_THRESHOLD_PX
          )
            return;
          const el = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-gutter-source]");
          if (!el || +el.dataset.gutterFile! !== file || el.dataset.gutterSide !== side) return;
          moved.current = true;
          next = range(origin, {
            hunk: +el.dataset.gutterHunk!,
            source: +el.dataset.gutterSource!,
            line: +el.dataset.gutterLine!,
            text: el.closest(".code-cell")?.querySelector(".source")?.textContent || "",
          });
          c.setSelection(next);
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          cleanup.current = null;
        };
        const up = () => {
          stop();
          if (next) c.finishSelection(next, extend, origin);
        };
        const cancel = () => {
          stop();
          c.setSelection(null);
        };
        cleanup.current = stop;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
      }}
      onClick={(e) => {
        if (!moved.current) c.selectLine(a, e.shiftKey, plus);
      }}
    >
      {plus ? <Plus /> : p.line}
    </button>
  );
}

export function lineSelected(
  line: DiffLine | undefined,
  file: number,
  hunk: number,
  side: Side,
  c: ReturnType<typeof useComments>,
) {
  const selected =
    c.selection ||
    c.drafts.find((d) => d.id === c.editor)?.anchor ||
    c.threads.find((t) => t.id === c.active)?.anchor;
  return !!line && !!selected && contains(selected, c.data.files[file].path, hunk, line, side);
}
