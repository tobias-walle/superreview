import type { Thread } from "../comments/model";
import type { ReviewIdentity, Snapshot, Submission } from "./types";

function code(text: string) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}
export function exportThread(thread: Thread): string {
  const a = thread.anchor;
  return [
    `### ${a.path.replace(/[\r\n]/g, " ")} · ${a.side === "old" ? "old" : "new"} L${a.start.line}${a.end.line !== a.start.line ? `–${a.end.line}` : ""}`,
    `Snapshot: ${a.snapshotId || "legacy snapshot"}${thread.resolved ? " · Resolved" : ""}`,
    code(a.excerpt),
    ...thread.messages.map(
      (m, i) =>
        `${i ? "**Reply**" : "**Comment**"}${m.deleted ? " (deleted)" : ""}\n\n${m.deleted ? "_Deleted in this round._" : m.body}`,
    ),
  ].join("\n\n");
}
export function exportSubmission(
  identity: ReviewIdentity,
  snapshot: Snapshot,
  submission: Submission,
): string {
  return (
    [
      `# ${identity.title} — submission ${submission.number}`,
      `Review: ${identity.id} · ${new Date(submission.created).toISOString()}`,
      `Repository: ${snapshot.data.repository}\n\nComparison: ${snapshot.label}\n\nBase: ${snapshot.base}\n\nTarget: ${snapshot.target}\n\nSnapshot: ${snapshot.id}`,
      submission.summary,
      ...submission.threads.map(exportThread),
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
