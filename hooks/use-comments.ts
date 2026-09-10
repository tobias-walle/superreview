import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FileMeta, ReviewData } from "@/lib/diff/render";
import {
  currentFile,
  comparePoints,
  range,
  LOCAL_HUMAN,
  uid,
  type Anchor,
  type Draft,
  type Thread,
} from "@/lib/comments/model";
import { useReviewSession } from "./use-review-session";
import {
  canAdjustDraft,
  numberedRange,
  selectionEvidence,
  retargetDraft,
} from "@/lib/comments/selection";

const EMPTY_THREADS: Thread[] = [];
const EMPTY_DRAFTS: Draft[] = [];
const SHOW_RESOLVED_STORAGE_KEY = "superreview-show-resolved-comments";

export function filterVisibleThreads(
  threads: Thread[],
  showResolved: boolean,
  draftThreadIds: ReadonlySet<string> = new Set(),
) {
  return threads.filter(
    (thread) => !thread.resolved || showResolved || draftThreadIds.has(thread.id),
  );
}

function initialShowResolved() {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(SHOW_RESOLVED_STORAGE_KEY) === "true"
  );
}

export function useCommentStore(data: ReviewData, meta: FileMeta[]) {
  const runtime = useReviewSession();
  const threads = runtime.session?.state.threads ?? EMPTY_THREADS;
  const drafts = runtime.session?.drafts ?? EMPTY_DRAFTS;
  const [editor, setEditor] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const rangeOrigins = useRef(new Map<string, Anchor>());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<null | (() => void)>(null);
  const [showResolved, setShowResolved] = useState(initialShowResolved);
  useEffect(() => {
    localStorage.setItem(SHOW_RESOLVED_STORAGE_KEY, String(showResolved));
  }, [showResolved]);
  useEffect(() => {
    if (!notice || undo) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice, undo]);
  const state = useRef({ threads, drafts });
  useEffect(() => {
    state.current = { threads, drafts };
  }, [threads, drafts]);
  async function write(kind: "thread" | "draft", value: Thread | Draft | null, id: string) {
    try {
      if (kind === "thread" && value)
        await runtime.execute({ type: "thread", thread: value as Thread });
      else if (kind === "draft") {
        const drafts = value
          ? [...state.current.drafts.filter((d) => d.id !== id), value as Draft]
          : state.current.drafts.filter((d) => d.id !== id);
        // Range and text changes can arrive before React commits the previous update.
        state.current = { ...state.current, drafts };
        await runtime.saveDrafts(drafts);
      }
      setError("");
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }
  function latest(id: string) {
    return state.current.threads.find((t) => t.id === id);
  }
  function begin(anchor: Anchor, threadId?: string, messageId?: string) {
    if (runtime.session?.state.archived) {
      setError("Reopen this review before adding feedback.");
      return;
    }
    if (!threadId) {
      const snapshot = runtime.session!.snapshot;
      anchor = selectionEvidence(snapshot.data, anchor, snapshot.id);
    }
    const id = messageId
      ? "edit-" + messageId
      : threadId
        ? "reply-" + threadId
        : state.current.drafts.find(
            (d) =>
              !d.threadId &&
              !d.messageId &&
              (d.anchor.kind || "line") === (anchor.kind || "line") &&
              d.anchor.path === anchor.path &&
              d.anchor.fingerprint === anchor.fingerprint &&
              d.anchor.side === anchor.side &&
              comparePoints(d.anchor.start, anchor.start) === 0 &&
              comparePoints(d.anchor.end, anchor.end) === 0,
          )?.id || "new-" + uid();
    if (!state.current.drafts.some((d) => d.id === id))
      write(
        "draft",
        {
          id,
          anchor,
          threadId,
          messageId,
          body: messageId
            ? latest(threadId!)?.messages.find((m) => m.id === messageId)?.body || ""
            : "",
        },
        id,
      );
    setEditor(id);
    setActive(threadId || null);
    setSelection(null);
    if (!rangeOrigins.current.has(id)) rangeOrigins.current.set(id, anchor);
    return id;
  }
  function adjustDraft(anchor: Anchor) {
    const draft = state.current.drafts.find((d) => d.id === editor);
    const snapshot = runtime.session!.snapshot;
    const updated = retargetDraft(draft, anchor, snapshot.data, snapshot.id);
    if (!updated) return;
    write("draft", updated, updated.id);
    setSelection(null);
  }
  function finishSelection(anchor: Anchor, extend = false, origin = anchor) {
    const draft = state.current.drafts.find((d) => d.id === editor);
    if (extend && draft) {
      if (canAdjustDraft(draft, anchor)) adjustDraft(anchor);
      else setSelection(null);
      return;
    }
    const id = begin(anchor);
    if (id) rangeOrigins.current.set(id, origin);
  }
  function selectionBase(anchor: Anchor) {
    const draft = state.current.drafts.find((d) => d.id === editor);
    if (!canAdjustDraft(draft, anchor)) return null;
    return rangeOrigins.current.get(draft.id) || draft.anchor;
  }
  function selectLine(anchor: Anchor, extend: boolean, plus: boolean) {
    const draft = state.current.drafts.find((d) => d.id === editor);
    const base = selectionBase(anchor);
    if (extend && draft) {
      if (base) adjustDraft(range(base, anchor.start));
      return;
    }
    if (
      plus &&
      canAdjustDraft(draft, anchor) &&
      comparePoints(anchor.start, draft.anchor.start) >= 0 &&
      comparePoints(anchor.end, draft.anchor.end) <= 0
    ) {
      document
        .querySelector<HTMLTextAreaElement>(`[data-composer="${draft.id}"] textarea`)
        ?.focus({ preventScroll: true });
      return;
    }
    begin(anchor);
  }
  function setDraftRange(start: number, end: number) {
    const draft = state.current.drafts.find((d) => d.id === editor);
    if (!draft) return false;
    const anchor = numberedRange(data, draft.anchor, start, end);
    if (!anchor || !canAdjustDraft(draft, anchor)) return false;
    adjustDraft(anchor);
    rangeOrigins.current.set(draft.id, anchor);
    return true;
  }
  const saving = useRef(new Set<string>());
  async function save(id: string) {
    if (saving.current.has(id)) return;
    const d = state.current.drafts.find((d) => d.id === id);
    if (!d?.body.trim()) return;
    const existing = d.threadId ? latest(d.threadId) : undefined;
    const t = existing || {
      id: uid(),
      anchor: d.anchor,
      created: Date.now(),
      messages: [],
    };
    const messages =
      d.messageId && existing
        ? t.messages.map((m) =>
            m.id === d.messageId
              ? { ...m, body: d.body.trim(), edited: Date.now(), editedBy: LOCAL_HUMAN }
              : m,
          )
        : [
            ...t.messages,
            { id: uid(), body: d.body.trim(), created: Date.now(), author: LOCAL_HUMAN },
          ];
    saving.current.add(id);
    const saved = await write("thread", { ...t, messages }, t.id);
    saving.current.delete(id);
    if (!saved) return;
    write("draft", null, id);
    setEditor(null);
    setActive(t.id);
    setUndo(null);
    setNotice(d.messageId ? "Comment updated" : d.threadId ? "Reply added" : "Comment added");
  }
  async function remove(threadId: string, messageId: string) {
    const t = latest(threadId);
    if (!t) return;
    const original = t.messages.find((m) => m.id === messageId);
    if (!original) return;
    const next = {
      ...t,
      messages: t.messages.map((m) =>
        m.id === messageId ? { ...m, body: "", deleted: true, deletedBy: LOCAL_HUMAN } : m,
      ),
    };
    if (!(await write("thread", next, t.id))) return;
    setNotice("Comment deleted");
    setUndo(() => () => {
      const now = latest(t.id) || next;
      write(
        "thread",
        {
          ...now,
          messages: now.messages.map((m) => (m.id === messageId ? original : m)),
        },
        t.id,
      );
      setUndo(null);
      setNotice("Comment restored");
    });
  }
  const presentThreads = useMemo(
    () => threads.filter((thread) => thread.messages.some((message) => !message.deleted)),
    [threads],
  );
  const draftThreadIds = useMemo(
    () => new Set(drafts.flatMap((draft) => (draft.threadId ? [draft.threadId] : []))),
    [drafts],
  );
  const visibleThreads = useMemo(
    () => filterVisibleThreads(presentThreads, showResolved, draftThreadIds),
    [presentThreads, showResolved, draftThreadIds],
  );
  const openThreads = useMemo(
    () => presentThreads.filter((thread) => !thread.resolved),
    [presentThreads],
  );
  function updateShowResolved(show: boolean) {
    setShowResolved(show);
    if (
      !show &&
      active &&
      presentThreads.some((thread) => thread.id === active && thread.resolved) &&
      !draftThreadIds.has(active)
    )
      setActive(null);
  }
  const byLocation = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of visibleThreads) {
      const a = t.anchor;
      if (a.kind === "file") continue;
      const key = `${a.fingerprint}:${a.end.hunk}:${a.end.source}`;
      map.set(key, [...(map.get(key) || []), t]);
    }
    return map;
  }, [visibleThreads]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of visibleThreads)
      if (currentFile(t.anchor, data, meta) >= 0)
        map.set(t.anchor.path, (map.get(t.anchor.path) || 0) + 1);
    return map;
  }, [visibleThreads, data, meta]);
  async function restoreResolution(originals: Thread[]) {
    for (const original of originals) {
      const current = latest(original.id) || original;
      await write(
        "thread",
        {
          ...current,
          resolved: original.resolved,
          resolvedAt: original.resolvedAt,
          resolvedBy: original.resolvedBy,
        },
        original.id,
      );
    }
    setUndo(null);
    setNotice(
      originals.length === 1 ? "Comment reopened" : `${originals.length} comments reopened`,
    );
  }
  async function resolveThread(thread: Thread) {
    const current = latest(thread.id) || thread;
    const resolved = !current.resolved;
    const saved = await write(
      "thread",
      {
        ...current,
        resolved,
        resolvedAt: resolved ? Date.now() : undefined,
        resolvedBy: resolved ? LOCAL_HUMAN : undefined,
      },
      current.id,
    );
    if (!saved) return false;
    setNotice(resolved ? "Comment resolved" : "Comment reopened");
    if (resolved) {
      if (!showResolved && !draftThreadIds.has(current.id)) setActive(null);
      setUndo(() => () => void restoreResolution([current]));
    } else setUndo(null);
    return true;
  }
  async function resolveAll() {
    const originals = state.current.threads.filter(
      (thread) => !thread.resolved && thread.messages.some((message) => !message.deleted),
    );
    const resolvedAt = Date.now();
    const completed: Thread[] = [];
    for (const thread of originals) {
      const saved = await write(
        "thread",
        { ...thread, resolved: true, resolvedAt, resolvedBy: LOCAL_HUMAN },
        thread.id,
      );
      if (!saved) return false;
      completed.push(thread);
    }
    if (!showResolved) setActive(null);
    setNotice(`${completed.length} comments resolved`);
    setUndo(() => () => void restoreResolution(completed));
    return true;
  }
  return {
    data,
    meta,
    threads: presentThreads,
    visibleThreads,
    openCount: openThreads.length,
    resolvedCount: presentThreads.length - openThreads.length,
    showResolved,
    setShowResolved: updateShowResolved,
    drafts,
    resolve: resolveThread,
    resolveAll,
    editor,
    setEditor,
    active,
    setActive,
    selection,
    setSelection,
    selectLine,
    selectionBase,
    finishSelection,
    setDraftRange,
    begin,
    save,
    remove,
    byLocation,
    counts,
    error,
    notice,
    undo,
    dismiss: () => {
      setNotice("");
      setUndo(null);
    },
    updateDraft: (id: string, body: string) => {
      const d = state.current.drafts.find((d) => d.id === id);
      if (d) write("draft", { ...d, body }, id);
    },
    discard: (id: string) => {
      write("draft", null, id);
      setEditor(null);
    },
    open: (t: Thread) => {
      setActive(t.id);
      setSelection(null);
      setEditor(null);
    },
  };
}
export type Comments = ReturnType<typeof useCommentStore>;
export const CommentContext = createContext<Comments | null>(null);
export function useComments() {
  return useContext(CommentContext)!;
}
