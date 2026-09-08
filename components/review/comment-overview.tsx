import { useEffect, useId, useMemo, useRef, useState } from "react";

import { SubmissionControls } from "./submissions";

import { CheckCircle2, CheckCheck, MessageSquare, PanelRightClose, Search, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useComments } from "@/hooks/use-comments";
import {
  authorName,
  currentFile,
  label,
  type Anchor,
  type Draft,
  type Thread,
} from "@/lib/comments/model";
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
    [scope, setScope] = useState("all"),
    [authorScope, setAuthorScope] = useState("all"),
    [confirmResolveAll, setConfirmResolveAll] = useState(false),
    [resolvingAll, setResolvingAll] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const showResolvedId = useId();
  const entries = useMemo(() => {
    const threads = c.visibleThreads.map((t) => ({
      id: t.id,
      anchor: t.anchor,
      body: t.messages.find((m) => !m.deleted)?.body || "Deleted comment",
      author: t.messages.find((m) => !m.deleted)?.author,
      thread: t,
      draft: undefined as Draft | undefined,
    }));
    const drafts = c.drafts
      .filter((d) => !d.threadId || !c.threads.some((t) => t.id === d.threadId))
      .map((d) => ({
        id: d.id,
        anchor: d.anchor,
        body: d.body || "Empty draft",
        author: undefined,
        thread: undefined as Thread | undefined,
        draft: d,
      }));
    return [...threads, ...drafts]
      .map((t) => ({ ...t, file: currentFile(t.anchor, c.data, c.meta) }))
      .filter(
        (t) =>
          (scope === "all" || t.anchor.path === c.data.files[selected]?.path) &&
          (authorScope === "all" ||
            !!t.draft ||
            t.thread?.messages.some((message) =>
              authorScope === "agent"
                ? message.author?.kind === "agent"
                : message.author?.kind !== "agent",
            )) &&
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
  }, [c.visibleThreads, c.threads, c.drafts, c.data, c.meta, selected, scope, authorScope, query]);
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
  const orphan = c.visibleThreads.find(
    (t) => t.id === c.active && currentFile(t.anchor, c.data, c.meta) < 0,
  );
  const openFileCount = new Set(
    c.threads.filter((thread) => !thread.resolved).map((thread) => thread.anchor.path),
  ).size;
  const orphanDraft = c.drafts.find(
    (d) => d.id === c.editor && currentFile(d.anchor, c.data, c.meta) < 0 && !d.threadId,
  );
  return (
    <div className="comments-overview">
      <div className="comments-heading">
        <MessageSquare />
        <h2>Comments</h2>
        <span className="comments-open-count">{c.openCount} open</span>
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
        <Tabs value={authorScope} onValueChange={setAuthorScope}>
          <TabsList aria-label="Comment author">
            <TabsTrigger value="all">All authors</TabsTrigger>
            <TabsTrigger value="human">Human</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="resolved-filter">
          <label htmlFor={showResolvedId}>
            <Checkbox
              id={showResolvedId}
              checked={c.showResolved}
              onCheckedChange={(checked) => c.setShowResolved(checked === true)}
            />
            Show resolved ({c.resolvedCount})
          </label>
          <button
            className="control resolve-all-control"
            disabled={!c.openCount || resolvingAll}
            onClick={() => setConfirmResolveAll(true)}
          >
            <CheckCheck aria-hidden="true" />
            Resolve all
          </button>
        </div>
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
                {query ||
                scope === "current" ||
                authorScope !== "all" ||
                (!c.showResolved && c.resolvedCount)
                  ? "No matching comments"
                  : "Start a conversation"}
              </h3>
              <p>
                {!c.showResolved &&
                c.resolvedCount &&
                !query &&
                scope === "all" &&
                authorScope === "all"
                  ? "Turn on Show resolved to view completed conversations."
                  : query || scope === "current" || authorScope !== "all"
                    ? "Try another search or change the filters."
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
                      className={`comment-card ${e.thread?.resolved ? "resolved" : ""} ${c.active === e.id || c.editor === e.id ? "active" : ""}`}
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
                          {e.thread?.resolved && <CheckCircle2 aria-hidden="true" />}
                          {label(e.anchor)}
                          {e.thread?.resolved ? " · Resolved" : ""}
                        </span>
                        {hasDraft && <span className="draft-badge">Draft</span>}
                      </div>
                      <p>{e.body.split(/\n\s*\n/)[0].replace(/[*`#_~]/g, "")}</p>
                      <div className="comment-card-bottom">
                        <span>
                          {e.draft ? "Continue writing" : authorName(e.author)}
                          {e.author?.kind === "agent" && <span className="agent-badge">Agent</span>}
                        </span>
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
      <Dialog
        open={confirmResolveAll}
        onOpenChange={(open) => !resolvingAll && setConfirmResolveAll(open)}
      >
        <DialogContent className="review-dialog resolve-all-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Resolve all open comments?</DialogTitle>
            <DialogDescription>
              This will resolve {c.openCount} {c.openCount === 1 ? "thread" : "threads"} across{" "}
              {openFileCount} {openFileCount === 1 ? "file" : "files"}. Draft comments are not
              affected.
            </DialogDescription>
          </DialogHeader>
          {c.error && (
            <p className="review-warning" role="alert">
              {c.error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="control"
              disabled={resolvingAll}
              onClick={() => setConfirmResolveAll(false)}
            >
              Cancel
            </button>
            <button
              className="control primary-control"
              disabled={resolvingAll || !c.openCount}
              onClick={async () => {
                setResolvingAll(true);
                const resolved = await c.resolveAll();
                setResolvingAll(false);
                if (resolved) setConfirmResolveAll(false);
              }}
            >
              <CheckCheck />
              {resolvingAll ? "Resolving…" : `Resolve all ${c.openCount}`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
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
