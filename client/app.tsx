import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitCompareArrows } from "lucide-react";

import { ChangedFilesSidebar, GuideScopeSelector } from "@/components/review/changed-files-sidebar";
import { GuideExplanation } from "@/components/review/guide-explanation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommentsPanel } from "@/components/review/comments-panel";
import { CommentFeedback } from "@/components/review/comments";
import { ContinuousDiff, type DiffHandle } from "@/components/review/continuous-diff";
import { DiffToolbar, type DiffMode } from "@/components/review/diff-toolbar";
import { ReviewControls } from "@/components/review/review-controls";
import { ReviewStatusbar } from "@/components/review/review-statusbar";
import { ReviewHeading, WorkspaceTopbar } from "@/components/review/workspace-header";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CommentContext, useCommentStore } from "@/hooks/use-comments";
import { useDiffModel } from "@/hooks/use-diff-model";
import { guideTargetAnchor, guideTargetChunk, useGuidedReview } from "@/hooks/use-guided-review";
import { useReviewProgress } from "@/hooks/use-review-progress";
import { ReviewSessionProvider, useReviewSession } from "@/hooks/use-review-session";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { useViewportWidth } from "@/hooks/use-viewport-width";
import { useWorkspaceShortcuts } from "@/hooks/use-workspace-shortcuts";
import { fileNavigation } from "@/lib/diff/file-order";
import { scopeContainsAnchor } from "@/lib/diff/scoped-blocks";
import type { ResolvedGuideTarget } from "@/lib/review/guide";
import { GUIDE_SOURCE_CONTEXT_LINES, guideSourceLines } from "@/lib/review/guide-source";
import type { Anchor } from "@/lib/comments/model";
import { reviewDocumentTitle } from "@/client/document-title";

const MOBILE_BREAKPOINT_PX = 768;
const COMMENTS_DRAWER_BREAKPOINT_PX = 1024;

export default function Home() {
  return (
    <ThemeProvider>
      <ReviewSessionProvider>
        <ReviewLoader />
      </ReviewSessionProvider>
    </ThemeProvider>
  );
}

function ReviewLoader() {
  const runtime = useReviewSession();
  if (runtime.session) return <Workspace />;
  const progress = runtime.capture;
  const message = progress
    ? progress.phase === "discovering"
      ? "Finding changed files…"
      : progress.total
        ? `${progress.phase === "saving" ? "Saving" : progress.phase === "diffing" ? "Preparing" : "Capturing"} changes · ${progress.completed} of ${progress.total}`
        : "Capturing changes…"
    : "Opening review…";
  return (
    <div className="review-loading">
      <GitCompareArrows />
      <h1>superreview</h1>
      <p role={runtime.error ? "alert" : "status"}>{runtime.error || message}</p>
      {runtime.error && (
        <button className="control" onClick={() => void runtime.refresh()}>
          Try again
        </button>
      )}
    </div>
  );
}

function Workspace() {
  const runtime = useReviewSession();
  const session = runtime.session!;
  const data = session.snapshot.data;
  const guide = useGuidedReview({
    snapshot: session.snapshot,
    state: session.state,
    load: runtime.readGuide,
    execute: runtime.execute,
  });
  const fileOrder = guide.fileOrder;
  const [selectedState, setSelected] = useState(0);
  const selected = fileOrder.includes(selectedState) ? selectedState : (fileOrder[0] ?? 0);
  const navigation = useMemo(() => fileNavigation(fileOrder, selected), [fileOrder, selected]);
  const [mode, setMode] = useState<DiffMode>(() =>
    innerWidth < MOBILE_BREAKPOINT_PX ? "unified" : "split",
  );
  const [wrap, setWrap] = useState(true);
  const [hideDeletions, setHideDeletions] = useState(false);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const viewportWidth = useViewportWidth();
  const diffRef = useRef<DiffHandle>(null);
  const returnLocation = useRef<{ snapshotId: string; chunkId: string; file: number } | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{
    snapshotId: string;
    file?: number;
    anchor?: Anchor;
    explanation?: boolean;
  } | null>(null);
  const [sourceTarget, setSourceTarget] = useState<ResolvedGuideTarget | null>(null);
  const model = useDiffModel(data.files);
  const progress = useReviewProgress(data, model.meta);
  const comments = useCommentStore(data, model.meta);
  const sidebars = useSidebarLayout(viewportWidth, commentsOpen);
  const { toggleTheme } = useTheme();
  const documentTitle = reviewDocumentTitle(
    data.repository,
    data.branch,
    session.snapshot.comparison?.refs,
  );

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  // Scope changes commit before scrolling. Progressive worker preparation must not lose clicks.
  useEffect(() => {
    const pending = pendingNavigation;
    if (!pending || pending.snapshotId !== session.snapshot.id) return;
    const file = pending.anchor
      ? data.files.findIndex((candidate) => candidate.path === pending.anchor!.path)
      : pending.file;
    if (pending.explanation) {
      if (!diffRef.current) return;
      diffRef.current.scrollToStart();
    } else {
      if (file === undefined || file < 0 || !model.meta[file] || !fileOrder.includes(file)) return;
      if (pending.anchor) {
        if (!scopeContainsAnchor(guide.scope, file, data.files[file], pending.anchor)) return;
        if (pending.anchor.side === "old" && hideDeletions) return;
        diffRef.current?.scrollToAnchor(pending.anchor);
      } else {
        diffRef.current?.scrollToFile(file);
      }
    }
    setPendingNavigation(null);
  }, [
    pendingNavigation,
    session.snapshot.id,
    data.files,
    model.meta,
    fileOrder,
    guide.scope,
    hideDeletions,
  ]);

  const chooseFile = useCallback(
    (file: number) => {
      if (!fileOrder.includes(file)) return;
      setSelected(file);
      setFileDrawerOpen(false);
      setPendingNavigation({ snapshotId: session.snapshot.id, file });
    },
    [fileOrder, session.snapshot.id],
  );
  const syncActiveFile = useCallback((file: number) => setSelected(file), []);

  function rememberGuidedLocation() {
    if (!guide.chunk) return;
    returnLocation.current = {
      snapshotId: session.snapshot.id,
      chunkId: guide.chunk.id,
      file: selected,
    };
  }
  function openFullFile(file: number, anchor?: Anchor) {
    if (anchor?.side === "old") setHideDeletions(false);
    rememberGuidedLocation();
    guide.selectChunk(null);
    setSelected(file);
    setPendingNavigation({ snapshotId: session.snapshot.id, file, anchor });
  }
  function selectScope(chunkId: string | null) {
    if (!chunkId) {
      rememberGuidedLocation();
      guide.selectChunk(null);
      setPendingNavigation({ snapshotId: session.snapshot.id, file: selected });
      return;
    }
    guide.selectChunk(chunkId);
    setPendingNavigation({ snapshotId: session.snapshot.id, explanation: true });
  }
  function returnToGuided() {
    if (guide.chunk) return;
    const previous = returnLocation.current;
    if (previous?.snapshotId === session.snapshot.id) {
      guide.selectChunk(previous.chunkId);
      setSelected(previous.file);
      setPendingNavigation({ snapshotId: session.snapshot.id, file: previous.file });
      return;
    }
    const first = guide.guide?.bundle.manifest.chunks[0];
    if (first) selectScope(first.id);
  }
  async function jumpToComment(anchor: Anchor) {
    if (anchor.side === "old") setHideDeletions(false);
    setCommentDrawerOpen(false);
    const snapshotId = anchor.snapshotId || session.snapshot.id;
    if (snapshotId !== session.snapshot.id) {
      const opened = await runtime.openSnapshot(snapshotId);
      if (opened) {
        guide.selectChunk(null, snapshotId);
        setPendingNavigation({ snapshotId, anchor });
      }
      return;
    }
    const file = data.files.findIndex((candidate) => candidate.path === anchor.path);
    if (file < 0) return;
    if (!scopeContainsAnchor(guide.scope, file, data.files[file], anchor)) {
      openFullFile(file, anchor);
      return;
    }
    setPendingNavigation({ snapshotId, anchor });
  }
  function jumpToTarget(id: string) {
    const revision = guide.guide;
    if (!revision || !Object.hasOwn(revision.resolvedTargets, id)) return;
    const resolved = revision.resolvedTargets[id];
    const anchor = guideTargetAnchor(session.snapshot.id, resolved);
    if (!anchor) {
      openFullFile(resolved.fileIndex);
      setSourceTarget(resolved);
      return;
    }
    if (anchor.side === "old") setHideDeletions(false);
    if (
      !scopeContainsAnchor(guide.scope, resolved.fileIndex, data.files[resolved.fileIndex], anchor)
    ) {
      const chunkId = guideTargetChunk(revision, data.files, id, anchor);
      guide.selectChunk(chunkId);
    }
    setSelected(resolved.fileIndex);
    setPendingNavigation({ snapshotId: session.snapshot.id, anchor });
  }

  const toggleMode = useCallback(
    () => setMode((current) => (current === "split" ? "unified" : "split")),
    [],
  );
  useWorkspaceShortcuts({
    navigation,
    onSelectFile: chooseFile,
    onToggleMode: toggleMode,
    onToggleTheme: toggleTheme,
  });

  const commentsUseDrawer = viewportWidth < COMMENTS_DRAWER_BREAKPOINT_PX;
  const chunks = guide.guide?.bundle.manifest.chunks || [];
  const partialScope = !!guide.scope && [...guide.scope.values()].some((file) => file.partial);
  let scopeLabel = session.snapshot.label;
  if (session.snapshot.comparison?.cached) scopeLabel += " · Staged only";
  if (session.snapshot.comparison?.unstaged) scopeLabel += " · Unstaged only";
  const paths = session.snapshot.comparison?.paths;
  if (paths?.length) scopeLabel += ` · Paths: ${paths.join(", ")}`;
  const explanation =
    guide.chunk && guide.guide ? (
      <GuideExplanation
        key={`${guide.guide.id}:${guide.chunk.id}`}
        title={guide.chunk.title}
        markdown={guide.guide.bundle.documents[guide.chunk.content]}
        onTarget={jumpToTarget}
        scopeLabel={scopeLabel}
        authorName={guide.guide.author.name}
      />
    ) : undefined;
  return (
    <CommentContext.Provider value={comments}>
      <div className="app-shell">
        <WorkspaceTopbar repository={data.repository} branch={data.branch} />
        <div className="workspace">
          <SidebarProvider>
            <ChangedFilesSidebar
              files={data.files}
              scopeIndices={fileOrder}
              partialScope={partialScope}
              guideSelector={
                session.state.guides.length ? (
                  <GuideScopeSelector
                    chunks={chunks}
                    reads={guide.reads}
                    selectedChunkId={guide.chunk?.id || null}
                    loading={guide.loading}
                    onSelect={selectScope}
                    onGuided={returnToGuided}
                    onRead={(chunkId, read) => void guide.setRead(chunkId, read)}
                    readDisabled={session.state.archived || runtime.busy || guide.readPending}
                  />
                ) : undefined
              }
              repository={data.repository}
              selected={selected}
              viewed={progress.viewed}
              readyFiles={model.meta.length}
              drawerOpen={fileDrawerOpen}
              width={sidebars.file.width}
              resizeBounds={sidebars.file.bounds}
              onSelect={chooseFile}
              onToggleViewed={progress.toggle}
              onDrawerChange={setFileDrawerOpen}
              onResize={sidebars.file.resize}
            />
            <main className="review-area">
              <ReviewHeading
                title={session.state.identity.title}
                fileCount={data.files.length}
                snapshotLabel={session.snapshot.label}
                branch={data.branch}
                commentCount={comments.openCount}
                commentsActive={commentsOpen && !commentsUseDrawer}
                commentsExpanded={commentsUseDrawer ? commentDrawerOpen : commentsOpen}
                onToggleComments={() =>
                  commentsUseDrawer ? setCommentDrawerOpen(true) : setCommentsOpen((open) => !open)
                }
              />
              <DiffToolbar
                mode={mode}
                hideDeletions={hideDeletions}
                onHideDeletionsChange={setHideDeletions}
                wrapLines={wrap}
                navigation={navigation}
                onModeChange={setMode}
                onOpenFiles={() => setFileDrawerOpen(true)}
                onToggleWrapLines={() => setWrap((enabled) => !enabled)}
                onSelectFile={chooseFile}
              />
              <ReviewControls />
              {guide.errors.map((error) => (
                <div className="review-error" role="alert" key={error}>
                  {error} All files remains available.
                </div>
              ))}
              {guide.newerAvailable && (
                <div className="review-info">
                  A newer guide is available.{" "}
                  <button onClick={() => location.reload()}>Reload to open it</button>
                </div>
              )}
              {!guide.guide && !guide.loading && guide.previousGuide && (
                <div className="review-info">
                  No guide for this snapshot.{" "}
                  <button
                    disabled={runtime.busy}
                    onClick={() => void runtime.openSnapshot(guide.previousGuide!.snapshotId)}
                  >
                    Open previous guide snapshot
                  </button>
                </div>
              )}
              <ContinuousDiff
                preparationMs={model.preparationMs}
                ref={diffRef}
                fileOrder={fileOrder}
                scope={guide.scope}
                explanation={explanation}
                onOpenFullFile={openFullFile}
                files={data.files}
                evidence={session.snapshot.evidence}
                readContent={runtime.readContent}
                meta={model.meta}
                error={model.error}
                mode={mode}
                hideDeletions={mode === "unified" && hideDeletions}
                onShowDeletions={() => setHideDeletions(false)}
                wrap={wrap}
                words
                viewed={progress.viewed}
                manual={progress.manual}
                onToggle={progress.toggle}
                onResume={progress.resume}
                markSeen={progress.markSeen}
                markTraversed={progress.markTraversed}
                onActive={syncActiveFile}
                getBlock={model.getBlock}
                request={model.request}
                version={model.version}
              />
            </main>
            <CommentsPanel
              selected={selected}
              sidebarVisible={sidebars.commentsVisible}
              drawerOpen={commentDrawerOpen && commentsUseDrawer}
              mobileComposer={viewportWidth < MOBILE_BREAKPOINT_PX}
              width={sidebars.comments.width}
              resizeBounds={sidebars.comments.bounds}
              onJump={jumpToComment}
              onCloseSidebar={() => setCommentsOpen(false)}
              onDrawerChange={setCommentDrawerOpen}
              onResize={sidebars.comments.resize}
            />
          </SidebarProvider>
        </div>
        <ReviewStatusbar branch={data.branch} fileCount={data.files.length} />
        <CommentFeedback />
        {sourceTarget && (
          <CapturedSourceFallback
            key={`${session.snapshot.id}:${sourceTarget.target.id}`}
            target={sourceTarget}
            readContent={runtime.readContent}
            onClose={() => setSourceTarget(null)}
          />
        )}
      </div>
    </CommentContext.Provider>
  );
}

function CapturedSourceFallback({
  target,
  readContent,
  onClose,
}: {
  target: ResolvedGuideTarget;
  readContent: (object: string) => Promise<string>;
  onClose: () => void;
}) {
  const side = target.target.kind === "range" ? target.target.side : "new";
  const object = target.sourceObjects[side];
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showFull, setShowFull] = useState(false);
  const selectedLine = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true;
    if (object) {
      void readContent(object)
        .then((text) => {
          if (active) setSource(text);
        })
        .catch((error: unknown) => {
          if (active) setError(error instanceof Error ? error.message : String(error));
        });
    }
    return () => {
      active = false;
    };
  }, [object, readContent]);
  useEffect(() => {
    selectedLine.current?.scrollIntoView({ block: "center" });
  }, [source, showFull]);
  const range =
    target.target.kind === "range" ? ` · Lines ${target.target.start}-${target.target.end}` : "";
  let content = <p role="status">Loading captured source…</p>;
  if (error) {
    content = <p role="alert">{error}</p>;
  } else if (!object) {
    content = <p>Captured source is unavailable for this side.</p>;
  } else if (source !== null && target.target.kind === "range") {
    const rangeTarget = target.target;
    const lines = guideSourceLines(source, rangeTarget, showFull);
    content = (
      <>
        <button
          type="button"
          className="guide-source-toggle"
          aria-expanded={showFull}
          onClick={() => setShowFull((current) => !current)}
        >
          {showFull ? "Show target excerpt" : "Show full captured source"}
        </button>
        <pre className="guide-source-content">
          <code>
            {lines.map((line) => (
              <span
                key={line.number}
                ref={line.number === rangeTarget.start ? selectedLine : undefined}
                className={`guide-source-line ${line.selected ? "is-target" : ""}`}
              >
                <span className="guide-source-line-number">{line.number}</span>
                <span>{line.text || " "}</span>
              </span>
            ))}
          </code>
        </pre>
      </>
    );
  } else if (source !== null) {
    content = (
      <pre className="guide-source-content">
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="guide-source-dialog">
        <DialogHeader>
          <DialogTitle>{target.target.path}</DialogTitle>
          <DialogDescription>
            This reference has no displayed diff coordinates. Captured {side}-side source
            {range}, with {GUIDE_SOURCE_CONTEXT_LINES} surrounding lines of context. This is not
            current worktree code.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
