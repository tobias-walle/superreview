import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";

import { MessageSquare, X, Send } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useComments } from "@/hooks/use-comments";
import { label, type Draft } from "@/lib/comments/model";
function DraftRange({ draft }: { draft: Draft }) {
  const c = useComments();
  const [start, setStart] = useState(String(draft.anchor.start.line));
  const [end, setEnd] = useState(String(draft.anchor.end.line));
  const [error, setError] = useState(false);
  function apply() {
    setError(!c.setDraftRange(Number(start), Number(end)));
  }
  return (
    <div className="composer-range-fields">
      <label>
        Lines{" "}
        <input
          aria-label="Start line"
          type="number"
          min="1"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      <label>
        to{" "}
        <input
          aria-label="End line"
          type="number"
          min="1"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      {error && (
        <span role="alert">Choose an ordered range of visible {draft.anchor.side} lines.</span>
      )}
    </div>
  );
}

export function Composer({ draft }: { draft: Draft }) {
  const c = useComments();
  const [tab, setTab] = useState("write");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [draft.id]);
  return (
    <div className="comment-composer" data-composer={draft.id}>
      <div className="composer-anchor">
        <MessageSquare />
        <strong>
          {draft.messageId ? "Edit comment" : draft.threadId ? "Reply" : "New comment"}
        </strong>
        <span>{label(draft.anchor)}</span>
        <button
          className="icon-button"
          onClick={() => c.setEditor(null)}
          aria-label="Close editor and keep draft"
        >
          <X />
        </button>
      </div>
      <div className="composer-path" title={draft.anchor.path}>
        {draft.anchor.path}
      </div>
      {!draft.threadId && !draft.messageId && draft.anchor.kind !== "file" && (
        <>
          <span className="composer-range-hint">Shift-click a line to adjust range</span>
          <DraftRange key={`${draft.anchor.start.line}-${draft.anchor.end.line}`} draft={draft} />
        </>
      )}
      <Tabs value={tab} onValueChange={setTab} className="comment-tabs">
        <TabsList aria-label="Comment editor mode">
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="write">
          <textarea
            ref={input}
            aria-label="Comment Markdown"
            placeholder={draft.threadId ? "Write a reply…" : "What should change, and why?"}
            value={draft.body}
            maxLength={30000}
            onChange={(e) => c.updateDraft(draft.id, e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                c.save(draft.id);
              }
            }}
          />
        </TabsContent>
        <TabsContent value="preview">
          <div className="markdown-preview">
            {draft.body.trim() ? (
              <Markdown body={draft.body} />
            ) : (
              <p className="comment-muted">Nothing to preview yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <div className="composer-footer">
        <span title="Markdown supported. Cmd or Ctrl + Enter to save.">
          Markdown · {c.error ? "Not saved" : "Draft saved"}
        </span>
        <button className="comment-text-button" onClick={() => c.discard(draft.id)}>
          Discard
        </button>
        <button
          disabled={!draft.body.trim()}
          className="comment-primary"
          onClick={() => c.save(draft.id)}
        >
          <Send />
          {draft.messageId ? "Save edit" : draft.threadId ? "Add reply" : "Add comment"}
        </button>
      </div>
    </div>
  );
}

export function MobileComposer({ mobile }: { mobile: boolean }) {
  const c = useComments(),
    draft = c.drafts.find((d) => d.id === c.editor);
  return (
    <Sheet
      open={mobile && !!draft}
      onOpenChange={(open) => {
        if (!open) c.setEditor(null);
      }}
    >
      <SheetContent side="bottom" className="mobile-comment-composer" showCloseButton={false}>
        <SheetHeader className="sr-only">
          <SheetTitle>Write a comment</SheetTitle>
          <SheetDescription>Markdown comment for the selected code.</SheetDescription>
        </SheetHeader>
        {draft && <Composer key={draft.id} draft={draft} />}
      </SheetContent>
    </Sheet>
  );
}
