import { authorName, type Thread } from "../comments/model";
import type { ReviewIdentity, Snapshot, Submission } from "./types";

function code(text: string) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}
export function exportThread(thread: Thread): string {
  const a = thread.anchor;
  const location =
    a.kind === "file"
      ? "file"
      : `${a.side === "old" ? "old" : "new"} L${a.start.line}${a.end.line !== a.start.line ? `–${a.end.line}` : ""}`;
  return [
    `### ${a.path.replace(/[\r\n]/g, " ")} · ${location}`,
    `Snapshot: ${a.snapshotId || "legacy snapshot"}${thread.resolved ? ` · Resolved by ${authorName(thread.resolvedBy)}` : ""}`,
    a.excerpt ? code(a.excerpt) : "",
    ...thread.messages.map((m, i) => {
      const name = authorName(m.author).replace(/[\r\n]/g, " ");
      const kind = m.author?.kind === "agent" ? " · Agent" : "";
      return `${i ? "**Reply" : "**Comment"} by ${name}${kind}**${m.deleted ? " (deleted)" : ""}\n\n${m.deleted ? "_Deleted in this round._" : m.body}`;
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function agentRequest(
  identity: ReviewIdentity,
  submission: Submission,
  task: "address" | "summarize",
) {
  const target = `Superreview submission ${submission.number} in review \`${identity.id}\``;
  const location = `Worktree: \`${identity.binding.worktree}\``;
  if (task === "summarize")
    return `Read and summarize ${target}.\n${location}\nDo not change code. Do not add replies. Do not resolve threads.`;
  return `Address ${target}.\n${location}\nRead the submitted feedback and the current thread conversations. Change the code as needed. Run the relevant checks. Reply to each thread with the result. Leave all threads unresolved for the human reviewer.`;
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
