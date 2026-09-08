import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FileMeta, ReviewData } from "@/lib/diff/render";
import {
  currentFile,
  LOCAL_HUMAN,
  uid,
  type Anchor,
  type Draft,
  type Thread,
} from "@/lib/comments/model";
import { useReviewSession } from "./use-review-session";

const EMPTY_THREADS: Thread[] = [];
const EMPTY_DRAFTS: Draft[] = [];

export function useCommentStore(data: ReviewData, meta: FileMeta[]) {
  const runtime = useReviewSession();
  const threads = runtime.session?.state.threads ?? EMPTY_THREADS;
  const drafts = runtime.session?.drafts ?? EMPTY_DRAFTS;
  const [editor, setEditor] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<Anchor | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<null | (() => void)>(null);
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
      else if (kind === "draft")
        await runtime.saveDrafts(
          value
            ? [...state.current.drafts.filter((d) => d.id !== id), value as Draft]
            : state.current.drafts.filter((d) => d.id !== id),
        );
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
      const file = snapshot.data.files.find((f) => f.path === anchor.path);
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
      anchor = {
        ...anchor,
        snapshotId: snapshot.id,
        excerpt: lines.join("\n").slice(0, 20000) || anchor.excerpt,
      };
    }
    const id = messageId
      ? "edit-" + messageId
      : threadId
        ? "reply-" + threadId
        : "new-" +
          [
            anchor.fingerprint,
            anchor.side,
            anchor.start.hunk,
            anchor.start.source,
            anchor.end.hunk,
            anchor.end.source,
          ].join("-");
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
    setRangeMode(false);
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
  const byLocation = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads.filter((t) => t.messages.some((m) => !m.deleted))) {
      const a = t.anchor;
      if (a.kind === "file") continue;
      const key = `${a.fingerprint}:${a.end.hunk}:${a.end.source}`;
      map.set(key, [...(map.get(key) || []), t]);
    }
    return map;
  }, [threads]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of threads.filter((t) => t.messages.some((m) => !m.deleted)))
      if (currentFile(t.anchor, data, meta) >= 0)
        map.set(t.anchor.path, (map.get(t.anchor.path) || 0) + 1);
    return map;
  }, [threads, data, meta]);
  return {
    data,
    meta,
    threads: threads.filter((t) => t.messages.some((m) => !m.deleted)),
    drafts,
    resolve: (t: Thread) => {
      const resolved = !t.resolved;
      return write(
        "thread",
        {
          ...t,
          resolved,
          resolvedAt: resolved ? Date.now() : undefined,
          resolvedBy: resolved ? LOCAL_HUMAN : undefined,
        },
        t.id,
      );
    },
    editor,
    setEditor,
    active,
    setActive,
    selection,
    setSelection,
    rangeMode,
    setRangeMode,
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
