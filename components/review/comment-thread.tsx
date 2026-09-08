import { Markdown } from "./markdown";

import { CopyButton } from "./copy-button";
import { exportThread } from "@/lib/review/markdown";
import {
  MessageSquare,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Pencil,
  Trash2,
} from "lucide-react";

import { useComments } from "@/hooks/use-comments";
import { authorInitial, authorName, label, type Thread } from "@/lib/comments/model";
import { Composer } from "./comment-editor";
export function ThreadView({ thread, previous = false }: { thread: Thread; previous?: boolean }) {
  const c = useComments(),
    expanded = c.active === thread.id;
  const draft = c.drafts.find((d) => d.threadId === thread.id && d.id === c.editor);
  const messages = thread.messages.filter((m) => !m.deleted);
  return (
    <section
      className={`comment-thread ${thread.resolved ? "thread-resolved" : ""} ${expanded ? "thread-active" : ""}`}
      data-thread={thread.id}
    >
      <button
        className="thread-summary"
        aria-expanded={expanded}
        onClick={() => {
          c.setActive(expanded ? null : thread.id);
          c.setEditor(null);
        }}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
        {thread.resolved ? <CheckCircle2 aria-hidden="true" /> : <MessageSquare />}
        <span className="thread-location">
          {label(thread.anchor)}
          {thread.resolved ? ` · Resolved by ${authorName(thread.resolvedBy)}` : ""}
        </span>
        <span className="thread-summary-text">
          {expanded
            ? `${messages.length} ${messages.length === 1 ? "comment" : "comments"}`
            : messages[0]?.body || "Deleted comment"}
        </span>
        {c.drafts.some((d) => d.threadId === thread.id) && (
          <span className="draft-badge">Draft</span>
        )}
      </button>
      {expanded && (
        <div className="thread-content">
          <div className="thread-tools">
            <button className="control" onClick={() => c.resolve(thread)}>
              {thread.resolved ? "Reopen thread" : "Resolve thread"}
            </button>
            <CopyButton text={exportThread(thread)} label="Copy thread" />
          </div>
          {previous && (
            <>
              <div className="previous-note">Previous diff · original code</div>
              <pre className="original-excerpt">{thread.anchor.excerpt}</pre>
            </>
          )}
          <div className="thread-messages">
            {thread.messages.map((m, i) => (
              <div className={`thread-message ${i > 0 ? "is-reply" : ""}`} key={m.id}>
                <div className="message-meta">
                  {i > 0 && <CornerDownRight />}
                  <span className="comment-avatar">{authorInitial(m.author)}</span>
                  <strong>{authorName(m.author)}</strong>
                  {m.author?.kind === "agent" && <span className="agent-badge">Agent</span>}
                  <time
                    dateTime={new Date(m.created).toISOString()}
                    title={new Date(m.created).toLocaleString()}
                  >
                    {new Date(m.created).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {m.edited ? ` · edited by ${authorName(m.editedBy || m.author)}` : ""}
                  </time>
                  {!m.deleted && m.author?.kind !== "agent" && (
                    <div className="message-actions">
                      <button
                        className="icon-button"
                        aria-label={i ? "Edit reply" : "Edit comment"}
                        onClick={() => c.begin(thread.anchor, thread.id, m.id)}
                      >
                        <Pencil />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={i ? "Delete reply" : "Delete comment"}
                        onClick={() => c.remove(thread.id, m.id)}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  )}
                </div>
                {m.deleted ? (
                  <p className="comment-muted">Comment deleted</p>
                ) : (
                  <Markdown body={m.body} />
                )}
              </div>
            ))}
          </div>
          {draft ? (
            <div className="inline-composer">
              <Composer key={draft.id} draft={draft} />
            </div>
          ) : (
            <button className="thread-reply" onClick={() => c.begin(thread.anchor, thread.id)}>
              <CornerDownRight />
              Reply…<span>Markdown supported</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function LineThreads({
  file,
  hunk,
  sources,
}: {
  file: number;
  hunk: number;
  sources: number[];
}) {
  const c = useComments(),
    fingerprint = c.meta[file]?.fingerprint;
  const threads = sources.flatMap((s) => c.byLocation.get(`${fingerprint}:${hunk}:${s}`) || []);
  const draft = c.drafts.find(
    (d) =>
      d.id === c.editor &&
      (!d.threadId || !c.threads.some((t) => t.id === d.threadId)) &&
      d.anchor.fingerprint === fingerprint &&
      d.anchor.end.hunk === hunk &&
      sources.includes(d.anchor.end.source),
  );
  if (!threads.length && !draft) return null;
  return (
    <div className="line-threads">
      {threads.map((t) => (
        <ThreadView key={t.id} thread={t} />
      ))}
      {draft && (
        <div className="inline-composer">
          <Composer key={draft.id} draft={draft} />
        </div>
      )}
    </div>
  );
}
