import { useState } from "react";
import { Check, History, Send, ArrowLeft, FileClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useReviewSession } from "@/hooks/use-review-session";
import { pendingThreads } from "@/lib/review/core";
import type { Submission } from "@/lib/review/types";
import { Markdown } from "./markdown";
import { CopyButton } from "./copy-button";

export function SubmissionControls() {
  const runtime = useReviewSession(),
    session = runtime.session!;
  const pending = pendingThreads(session.state);
  const [screen, setScreen] = useState<"submit" | "success" | "history" | "detail" | null>(null);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [summary, setSummary] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const drafts = session.drafts.filter((d) => d.body.trim()).length;
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const state = await runtime.execute({ type: "submit", summary });
      setSelected(state.submissions.at(-1)!);
      setSummary("");
      setScreen("success");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="submission-footer">
        <div className="submission-status">
          <span>Saved locally</span>
          <span>{pending.length} pending</span>
        </div>
        <div className="submission-actions">
          <button
            className="control"
            onClick={() => setScreen("history")}
            title="Submission history"
          >
            <History />
            <span>History</span>
            <span className="count">{session.state.submissions.length}</span>
          </button>
          <button
            className="control primary-control"
            disabled={session.state.archived}
            onClick={() => setScreen("submit")}
          >
            <Send />
            Submit review
          </button>
        </div>
      </div>
      <Dialog
        open={!!screen}
        onOpenChange={(open) => {
          if (!open && !busy) setScreen(null);
        }}
      >
        <DialogContent className="review-dialog">
          <DialogHeader>
            <DialogTitle>
              {screen === "submit"
                ? "Submit review"
                : screen === "success"
                  ? `Submission #${selected?.number} saved`
                  : screen === "history"
                    ? "Submission history"
                    : `Submission #${selected?.number}`}
            </DialogTitle>
            <DialogDescription>
              {screen === "submit"
                ? "Save a permanent round of feedback. You can keep reviewing afterward."
                : screen === "success"
                  ? "Your feedback is saved locally. What would you like to do next?"
                  : "Each submission keeps the feedback and code references as they were submitted."}
            </DialogDescription>
          </DialogHeader>
          {screen === "submit" && (
            <>
              <div className="submission-meta">
                <span>
                  {pending.length} changed {pending.length === 1 ? "thread" : "threads"}
                </span>
                <span>Round #{session.state.submissions.length + 1}</span>
              </div>
              {drafts > 0 && (
                <p className="review-warning">
                  {drafts} unfinished {drafts === 1 ? "draft is" : "drafts are"} excluded. Save each
                  comment to include it.
                </p>
              )}
              <div className="submission-preview">
                {pending.map((t) => (
                  <div key={t.id}>
                    <code>
                      {t.anchor.path}:{t.anchor.start.line}
                    </code>
                    <p>{t.messages.filter((m) => !m.deleted).at(-1)?.body || "Comment deleted"}</p>
                  </div>
                ))}
              </div>
              <label className="summary-label">
                Review summary <span>optional</span>
                <textarea
                  aria-label="Review summary"
                  placeholder="Overall feedback, next steps, or a note for your agent…"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={30000}
                />
              </label>
              {error && (
                <p role="alert" className="review-warning">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button className="control" onClick={() => setScreen(null)} disabled={busy}>
                  Keep reviewing
                </button>
                <button
                  className="control primary-control"
                  disabled={busy || (!pending.length && !summary.trim())}
                  onClick={submit}
                >
                  <Send />
                  {busy ? "Saving…" : "Confirm submission"}
                </button>
              </div>
            </>
          )}
          {screen === "success" && selected && (
            <>
              <div className="submission-success">
                <Check />
                <strong>
                  {selected.threads.length} threads · round #{selected.number}
                </strong>
                <span>{new Date(selected.created).toLocaleString()}</span>
              </div>
              <div className="next-actions">
                <CopyButton text={selected.markdown} />
                <button className="control" onClick={() => setScreen("detail")}>
                  <FileClock />
                  View submission
                </button>
                <button className="control primary-control" onClick={() => setScreen(null)}>
                  Continue reviewing
                </button>
              </div>
            </>
          )}
          {screen === "history" && (
            <div className="submission-history">
              {!session.state.submissions.length && (
                <p>
                  No submissions yet. Your saved comments remain pending until you submit a review.
                </p>
              )}
              {[...session.state.submissions].reverse().map((s) => (
                <button
                  className="submission-row"
                  key={s.id}
                  onClick={() => {
                    setSelected(s);
                    setScreen("detail");
                  }}
                >
                  <span>
                    <strong>Submission #{s.number}</strong>
                    <time>{new Date(s.created).toLocaleString()}</time>
                  </span>
                  <p>{s.summary || `${s.threads.length} changed threads`}</p>
                  <span>{s.threads.length} threads →</span>
                </button>
              ))}
            </div>
          )}
          {screen === "detail" && selected && (
            <>
              <div className="submission-detail-actions">
                <button className="control" onClick={() => setScreen("history")}>
                  <ArrowLeft />
                  History
                </button>
                <CopyButton text={selected.markdown} />
              </div>
              <div className="submission-document">
                <Markdown body={selected.markdown} />
              </div>
              <button
                className="control"
                onClick={() => {
                  void runtime.openSnapshot(selected.snapshotId);
                  setScreen(null);
                }}
              >
                <FileClock />
                Open captured diff
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
