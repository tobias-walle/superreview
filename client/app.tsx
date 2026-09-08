import { useCallback, useEffect, useRef, useState } from "react";
import { GitCompareArrows } from "lucide-react";

import { ChangedFilesSidebar } from "@/components/review/changed-files-sidebar";
import { CommentsPanel } from "@/components/review/comments-panel";
import { CommentFeedback, SelectionBar } from "@/components/review/comments";
import { ContinuousDiff, type DiffHandle } from "@/components/review/continuous-diff";
import { DiffToolbar, type DiffMode } from "@/components/review/diff-toolbar";
import { ReviewControls } from "@/components/review/review-controls";
import { ReviewStatusbar } from "@/components/review/review-statusbar";
import { ReviewHeading, WorkspaceTopbar } from "@/components/review/workspace-header";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CommentContext, useCommentStore } from "@/hooks/use-comments";
import { useDiffModel } from "@/hooks/use-diff-model";
import { useReviewProgress } from "@/hooks/use-review-progress";
import { ReviewSessionProvider, useReviewSession } from "@/hooks/use-review-session";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { useViewportWidth } from "@/hooks/use-viewport-width";
import { useWorkspaceShortcuts } from "@/hooks/use-workspace-shortcuts";
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
  const [selectedState, setSelected] = useState(0);
  const selected = Math.min(selectedState, Math.max(0, data.files.length - 1));
  const [mode, setMode] = useState<DiffMode>(() =>
    innerWidth < MOBILE_BREAKPOINT_PX ? "unified" : "split",
  );
  const [wrap, setWrap] = useState(true);
  const [words, setWords] = useState(true);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const viewportWidth = useViewportWidth();
  const diffRef = useRef<DiffHandle>(null);
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

  const chooseFile = useCallback(
    (file: number) => {
      if (file < 0 || file >= data.files.length) return;
      setSelected(file);
      setFileDrawerOpen(false);
      diffRef.current?.scrollToFile(file);
    },
    [data.files.length],
  );
  const syncActiveFile = useCallback((file: number) => setSelected(file), []);
  const jumpToComment = useCallback((anchor: Anchor) => {
    setCommentDrawerOpen(false);
    diffRef.current?.scrollToAnchor(anchor);
  }, []);

  const toggleMode = useCallback(
    () => setMode((current) => (current === "split" ? "unified" : "split")),
    [],
  );
  useWorkspaceShortcuts({
    selected,
    fileCount: data.files.length,
    onSelectFile: chooseFile,
    onToggleMode: toggleMode,
    onToggleTheme: toggleTheme,
  });

  const commentsUseDrawer = viewportWidth < COMMENTS_DRAWER_BREAKPOINT_PX;
  return (
    <CommentContext.Provider value={comments}>
      <div className="app-shell">
        <WorkspaceTopbar repository={data.repository} branch={data.branch} />
        <div className="workspace">
          <SidebarProvider>
            <ChangedFilesSidebar
              files={data.files}
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
                wordHighlights={words}
                wrapLines={wrap}
                selected={selected}
                fileCount={data.files.length}
                onModeChange={setMode}
                onOpenFiles={() => setFileDrawerOpen(true)}
                onToggleWordHighlights={() => setWords((enabled) => !enabled)}
                onToggleWrapLines={() => setWrap((enabled) => !enabled)}
                onSelectFile={chooseFile}
              />
              <ReviewControls />
              <SelectionBar />
              <ContinuousDiff
                preparationMs={model.preparationMs}
                ref={diffRef}
                files={data.files}
                meta={model.meta}
                error={model.error}
                mode={mode}
                wrap={wrap}
                words={words}
                viewed={progress.viewed}
                manual={progress.manual}
                onToggle={progress.toggle}
                onResume={progress.resume}
                markSeen={progress.markSeen}
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
      </div>
    </CommentContext.Provider>
  );
}
