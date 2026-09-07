import { useEffect, useMemo, useRef, useState } from "react";

import { SubmissionControls } from "./submissions";

import { MessageSquare, X, Search, PanelRightClose } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useComments } from "@/hooks/use-comments";
import { currentFile, label, type Anchor, type Draft, type Thread } from "@/lib/comments/model";
import { Composer } from "./comment-editor";
import { ThreadView } from "./comment-thread";
export function CommentOverview({
  selected,
  onJump,
  onClose,
}: {
  selected: number;
  onJump: (anchor: Anchor) => void;
  onClose: () => void;
}) {
  const c = useComments(),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("all");
  const root = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const threads = c.threads.map((t) => ({
      id: t.id,
      anchor: t.anchor,
      body: t.messages.find((m) => !m.deleted)?.body || "Deleted comment",
      thread: t,
      draft: undefined as Draft | undefined,
    }));
    const drafts = c.drafts
      .filter((d) => !d.threadId || !c.threads.some((t) => t.id === d.threadId))
      .map((d) => ({
        id: d.id,
        anchor: d.anchor,
        body: d.body || "Empty draft",
        thread: undefined as Thread | undefined,
        draft: d,
      }));
    return [...threads, ...drafts]
      .map((t) => ({ ...t, file: currentFile(t.anchor, c.data, c.meta) }))
      .filter(
        (t) =>
          (scope === "all" || t.anchor.path === c.data.files[selected]?.path) &&
          (!query ||
            [t.anchor.path, t.body, ...(t.thread?.messages.map((m) => m.body) || [])]
              .join("\n")
              .toLowerCase()
              .includes(query.toLowerCase())),
      )
      .sort(
        (a, b) =>
          (a.file < 0 ? 1 : 0) - (b.file < 0 ? 1 : 0) ||
          a.anchor.path.localeCompare(b.anchor.path) ||
          a.anchor.start.line - b.anchor.start.line ||
          a.id.localeCompare(b.id),
      );
  }, [c.threads, c.drafts, c.data, c.meta, selected, scope, query]);
  // TanStack Virtual exposes callbacks React Compiler cannot memoize safely.
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => root.current,
    estimateSize: () => 128,
    getItemKey: (i) => entries[i].id,
    overscan: 4,
  });
  useEffect(() => {
    const i = entries.findIndex((e) => e.id === c.active || e.id === c.editor);
    if (i >= 0) virtual.scrollToIndex(i, { align: "auto" });
  }, [c.active, c.editor, entries, virtual]);
  const orphan = c.threads.find(
    (t) => t.id === c.active && currentFile(t.anchor, c.data, c.meta) < 0,
  );
  const orphanDraft = c.drafts.find(
    (d) => d.id === c.editor && currentFile(d.anchor, c.data, c.meta) < 0 && !d.threadId,
  );
  return (
    <div className="comments-overview">
      <div className="comments-heading">
        <MessageSquare />
        <h2>Comments</h2>
        <span className="count">{c.threads.length}</span>
        <button className="icon-button" aria-label="Close comments overview" onClick={onClose}>
          <PanelRightClose />
        </button>
      </div>
      <div className="comment-filters">
        <label className="comment-search">
          <Search />
          <input
            aria-label="Search comments"
            placeholder="Search comments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList aria-label="Comment scope">
            <TabsTrigger value="all">All files</TabsTrigger>
            <TabsTrigger value="current">Current file</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {orphan || orphanDraft ? (
        <div className="previous-detail">
          <button
            className="comment-text-button"
            onClick={() => {
              c.setActive(null);
              c.setEditor(null);
            }}
          >
            ← All comments
          </button>
          {orphan && <ThreadView thread={orphan} previous />}
          {orphanDraft && (
            <>
              <div className="previous-note">Previous diff</div>
              <pre className="original-excerpt">{orphanDraft.anchor.excerpt}</pre>
              <Composer draft={orphanDraft} />
            </>
          )}
        </div>
      ) : (
        <div className="comment-list" ref={root}>
          {!entries.length ? (
            <div className="comments-empty">
              <MessageSquare />
              <h3>
                {query || scope === "current" ? "No matching comments" : "Start a conversation"}
              </h3>
              <p>
                {query || scope === "current"
                  ? "Try another search or show all files."
                  : "Select a line number to comment. Shift-click another line to select a range."}
              </p>
            </div>
          ) : (
            <div style={{ position: "relative", height: virtual.getTotalSize() }}>
              {virtual.getVirtualItems().map((v) => {
                const e = entries[v.index],
                  prev = entries[v.index - 1],
                  group =
                    !prev || prev.anchor.path !== e.anchor.path || prev.file < 0 !== e.file < 0;
                const hasDraft = !!e.draft || c.drafts.some((d) => d.threadId === e.id);
                return (
                  <div
                    key={e.id}
                    ref={virtual.measureElement}
                    data-index={v.index}
                    className="comment-list-item"
                    style={{
                      position: "absolute",
                      top: 0,
                      width: "100%",
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    {group && (
                      <div className="comment-file-group" title={e.anchor.path}>
                        {e.file < 0 && <span>Previous diff</span>}
                        {e.anchor.path}
                      </div>
                    )}
                    <button
                      className={`comment-card ${c.active === e.id || c.editor === e.id ? "active" : ""}`}
                      onClick={() => {
                        if (e.thread) c.open(e.thread);
                        else {
                          c.setEditor(e.draft!.id);
                          c.setActive(null);
                        }
                        if (e.file >= 0) onJump(e.anchor);
                      }}
                    >
                      <div className="comment-card-top">
                        <span>
                          {label(e.anchor)}
                          {e.thread?.resolved ? " · Resolved" : ""}
                        </span>
                        {hasDraft && <span className="draft-badge">Draft</span>}
                      </div>
                      <p>{e.body.split(/\n\s*\n/)[0].replace(/[*`#_~]/g, "")}</p>
                      <div className="comment-card-bottom">
                        <span>{e.draft ? "Continue writing" : "You"}</span>
                        {e.thread && (
                          <span>
                            <MessageSquare />
                            {Math.max(
                              0,
                              e.thread.messages.filter((m) => !m.deleted).length - 1,
                            )}{" "}
                            {e.thread.messages.filter((m) => !m.deleted).length === 2
                              ? "reply"
                              : "replies"}
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <SubmissionControls />
    </div>
  );
}

export function CommentFeedback() {
  const c = useComments();
  return (
    <>
      {c.error && (
        <div className="comment-error" role="alert">
          {c.error}
        </div>
      )}
      {c.notice && (
        <div className="comment-toast" role="status">
          {c.notice}
          {c.undo && <button onClick={c.undo}>Undo</button>}
          <button aria-label="Dismiss notification" onClick={c.dismiss}>
            <X />
          </button>
        </div>
      )}
    </>
  );
}
