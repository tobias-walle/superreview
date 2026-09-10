import type { ReviewData } from "../diff/render";
import { range, type Anchor, type Draft, type Point } from "./model";

// Resolve only visible snapshot lines. Never invent locations in hidden context.
export function selectionPoint(
  data: ReviewData,
  anchor: Anchor,
  number: number,
): Point | undefined {
  const file = data.files.find((file) => file.path === anchor.path);
  for (const [hunkIndex, hunk] of (file?.hunks || []).entries()) {
    let line = anchor.side === "old" ? hunk.oldStart : hunk.newStart;
    for (const [source, text] of hunk.lines.entries()) {
      if (text.startsWith("\\") || text.startsWith(anchor.side === "old" ? "+" : "-")) continue;
      if (line === number) return { hunk: hunkIndex, source, line, text: text.slice(1) };
      line++;
    }
  }
}

export function selectionEvidence(data: ReviewData, anchor: Anchor, snapshotId: string): Anchor {
  const file = data.files.find((file) => file.path === anchor.path);
  const lines: string[] = [];
  for (const hunk of file?.hunks || []) {
    let line = anchor.side === "old" ? hunk.oldStart : hunk.newStart;
    for (const text of hunk.lines) {
      if (text.startsWith("\\") || text.startsWith(anchor.side === "old" ? "+" : "-")) continue;
      if (line >= anchor.start.line && line <= anchor.end.line)
        lines.push(`${line}: ${text.slice(1)}`);
      line++;
    }
  }
  return { ...anchor, snapshotId, excerpt: lines.join("\n").slice(0, 20000) || anchor.excerpt };
}

export function canAdjustDraft(draft: Draft | undefined, anchor: Anchor): draft is Draft {
  return (
    !!draft &&
    !draft.threadId &&
    !draft.messageId &&
    draft.anchor.kind !== "file" &&
    anchor.kind !== "file" &&
    draft.anchor.path === anchor.path &&
    draft.anchor.side === anchor.side &&
    draft.anchor.fingerprint === anchor.fingerprint
  );
}

export function retargetDraft(
  draft: Draft | undefined,
  anchor: Anchor,
  data: ReviewData,
  snapshotId: string,
): Draft | undefined {
  if (!canAdjustDraft(draft, anchor)) return;
  return { ...draft, anchor: selectionEvidence(data, anchor, snapshotId) };
}

export function numberedRange(
  data: ReviewData,
  anchor: Anchor,
  start: number,
  end: number,
): Anchor | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return;
  const first = selectionPoint(data, anchor, start);
  const last = selectionPoint(data, anchor, end);
  if (first && last) return range({ ...anchor, start: first }, last);
}
