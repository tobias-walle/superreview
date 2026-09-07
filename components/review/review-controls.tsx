import { RefreshCw, Archive, ArrowLeft } from "lucide-react";
import { useReviewSession } from "@/hooks/use-review-session";
export function ReviewControls() {
  const rt = useReviewSession(),
    session = rt.session!;
  const historical = session.snapshot.id !== session.state.snapshotId;
  return (
    <>
      <div className="review-session-bar">
        <div className="review-view-switch" role="group" aria-label="Review comparison">
          <button
            className={rt.view === "full" ? "selected" : ""}
            disabled={rt.busy || session.state.archived}
            onClick={() => void rt.refresh("full")}
          >
            Full comparison
          </button>
          <button
            className={rt.view === "since" ? "selected" : ""}
            disabled={rt.busy || session.state.archived}
            onClick={() => void rt.refresh("since")}
          >
            Since reviewed
          </button>
        </div>
        <div className="review-session-actions">
          {historical ? (
            <button
              className="control"
              onClick={() => void rt.openSnapshot(session.state.snapshotId)}
            >
              <ArrowLeft />
              Current snapshot
            </button>
          ) : (
            <button
              className="icon-button"
              aria-label="Refresh changes"
              title="Refresh changes"
              disabled={rt.busy || session.state.archived}
              onClick={() => void rt.refresh()}
            >
              <RefreshCw className={rt.busy ? "spin" : ""} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label={session.state.archived ? "Reopen review" : "Archive review"}
            title={session.state.archived ? "Reopen review" : "Archive review"}
            onClick={() =>
              void rt
                .execute({ type: "archive", archived: !session.state.archived })
                .catch(() => {})
            }
          >
            <Archive />
          </button>
          {session.state.archived && <span>Archived</span>}
        </div>
      </div>
      {historical && (
        <div className="review-info">
          Captured diff · {new Date(session.snapshot.created).toLocaleString()} · Viewed progress is
          read-only here.
        </div>
      )}
      {rt.error && (
        <div className="review-error" role="alert">
          {rt.error}
          <button onClick={() => location.reload()}>Reload review</button>
        </div>
      )}
    </>
  );
}
