import { useRef } from "react";

import { MessageSquare, Plus, X, TextSelect } from "lucide-react";

import { useComments } from "@/hooks/use-comments";
import { contains, label, point, range, type Anchor, type Side } from "@/lib/comments/model";
import type { DiffLine } from "@/lib/diff/render";
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
  const c = useComments(),
    path = c.data.files[file].path;
  const p = point(line, hunk, side),
    moved = useRef(false);
  const a: Anchor = {
    path,
    fingerprint: c.meta[file].fingerprint,
    side,
    start: p,
    end: p,
    excerpt: p.text,
  };
  function select(extend: boolean) {
    const base = c.selection;
    const next =
      extend && base?.path === path && base.side === side
        ? range({ ...base, end: base.start }, p)
        : a;
    c.setSelection(next);
    c.setEditor(null);
    c.setActive(null);
    if (c.rangeMode) c.setRangeMode(false);
    return next;
  }
  return (
    <button
      className={plus ? "line-comment-add" : "line-no line-target"}
      aria-label={plus ? `Comment on ${side} line ${p.line}` : `Select ${side} line ${p.line}`}
      title={plus ? "Add comment" : "Select line · Shift-click to extend"}
      data-gutter-file={file}
      data-gutter-hunk={hunk}
      data-gutter-source={p.source}
      data-gutter-side={side}
      data-gutter-line={p.line}
      onPointerDown={(e) => {
        moved.current = false;
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        const origin =
          e.shiftKey && c.selection?.path === path && c.selection.side === side
            ? { ...c.selection, end: c.selection.start }
            : a;
        const startX = e.clientX,
          startY = e.clientY;
        const move = (event: PointerEvent) => {
          if (Math.abs(event.clientY - startY) + Math.abs(event.clientX - startX) < 4) return;
          const el = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-gutter-source]");
          if (!el || +el.dataset.gutterFile! !== file || el.dataset.gutterSide !== side) return;
          moved.current = true;
          c.setSelection(
            range(origin, {
              hunk: +el.dataset.gutterHunk!,
              source: +el.dataset.gutterSource!,
              line: +el.dataset.gutterLine!,
              text: el.closest(".code-cell")?.querySelector(".source")?.textContent || "",
            }),
          );
          c.setEditor(null);
          c.setActive(null);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
      onClick={(e) => {
        if (moved.current) return;
        const next = select(e.shiftKey || c.rangeMode);
        if (plus && !e.shiftKey) c.begin(next);
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
    c.threads.find((t) => t.id === c.active)?.anchor ||
    c.drafts.find((d) => d.id === c.editor)?.anchor;
  return !!line && !!selected && contains(selected, c.data.files[file].path, hunk, line, side);
}

export function SelectionBar() {
  const c = useComments();
  if (!c.selection) return null;
  return (
    <div className="line-selection-bar" role="region" aria-label="Selected lines">
      <TextSelect />
      <span>{label(c.selection)}</span>
      <button className="comment-primary" onClick={() => c.begin(c.selection!)}>
        <MessageSquare />
        Comment
      </button>
      <button
        className={`control ${c.rangeMode ? "active" : ""}`}
        onClick={() => c.setRangeMode(!c.rangeMode)}
      >
        {c.rangeMode ? "Tap the last line" : "Select range"}
      </button>
      <button
        className="icon-button"
        aria-label="Clear selection"
        onClick={() => {
          c.setSelection(null);
          c.setRangeMode(false);
        }}
      >
        <X />
      </button>
    </div>
  );
}
