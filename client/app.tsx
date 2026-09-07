import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  GitBranch,
  GitCompareArrows,
  Folder,
  Columns2,
  Rows3,
  Sun,
  Moon,
  Monitor,
  Smartphone,
  PanelLeft,
  WrapText,
  ArrowUp,
  ArrowDown,
  Terminal,
  FileDiff,
  MessageSquare,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SidebarProvider, Sidebar } from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { ReviewFile } from "@/lib/diff/render";
import { FileTree } from "@/components/review/file-tree";
import { ContinuousDiff, type DiffHandle } from "@/components/review/continuous-diff";
import { useDiffModel } from "@/hooks/use-diff-model";
import { useReviewProgress } from "@/hooks/use-review-progress";
import { CommentContext, useCommentStore } from "@/hooks/use-comments";
import {
  CommentOverview,
  SelectionBar,
  MobileComposer,
  CommentFeedback,
} from "@/components/review/comments";
import type { Anchor } from "@/lib/comments/model";
import { ReviewSessionProvider, useReviewSession } from "@/hooks/use-review-session";
import { ReviewControls } from "@/components/review/review-controls";
import { clampSidebarWidth, SidebarResizer } from "@/components/review/sidebar-resizer";

const FILE_SIDEBAR_INITIAL_WIDTH_PX = 246;
const FILE_SIDEBAR_MIN_WIDTH_PX = 200;
const FILE_SIDEBAR_MAX_WIDTH_PX = 400;
const COMMENT_SIDEBAR_INITIAL_WIDTH_PX = 300;
const COMMENT_SIDEBAR_MIN_WIDTH_PX = 260;
const COMMENT_SIDEBAR_MAX_WIDTH_PX = 440;
const REVIEW_AREA_MIN_WIDTH_PX = 420;

function Stats({ files }: { files: ReviewFile[] }) {
  return (
    <div className="change-summary">
      <span className="stat plus">+{files.reduce((s, f) => s + f.additions, 0)}</span>
      <span className="stat minus">−{files.reduce((s, f) => s + f.deletions, 0)}</span>
      <span>lines changed</span>
      <div className="diff-meter" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}
export default function Home() {
  return (
    <ReviewSessionProvider>
      <ReviewLoader />
    </ReviewSessionProvider>
  );
}
function ReviewLoader() {
  const runtime = useReviewSession();
  if (!runtime.session)
    return (
      <div className="review-loading">
        <GitCompareArrows />
        <h1>superreview</h1>
        <p role={runtime.error ? "alert" : "status"}>{runtime.error || "Opening review…"}</p>
        {runtime.error && (
          <button className="control" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </div>
    );
  return <Workspace />;
}
function Workspace() {
  const runtime = useReviewSession();
  const data = runtime.session!.snapshot.data;
  const params = new URLSearchParams(location.search);
  const embedded = params.has("desktop");
  const [selectedState, setSelected] = useState(0);
  const selected = Math.min(selectedState, Math.max(0, data.files.length - 1));
  const [mode, setMode] = useState(() => (!embedded && innerWidth < 768 ? "unified" : "split"));
  const [theme, setTheme] = useState(
    () => params.get("theme") || localStorage.getItem("patchwork-theme") || "mocha",
  );
  const [wrap, setWrap] = useState(true);
  const [words, setWords] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const diffRef = useRef<DiffHandle>(null);
  const model = useDiffModel(data.files);
  const progress = useReviewProgress(data, model.meta);
  const comments = useCommentStore(data, model.meta);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [commentDrawer, setCommentDrawer] = useState(false);
  const [fileSidebarWidth, setFileSidebarWidth] = useState(FILE_SIDEBAR_INITIAL_WIDTH_PX);
  const [commentSidebarWidth, setCommentSidebarWidth] = useState(COMMENT_SIDEBAR_INITIAL_WIDTH_PX);
  function jumpComment(a: Anchor) {
    setCommentDrawer(false);
    diffRef.current?.scrollToAnchor(a);
  }
  const syncActive = useCallback((n: number) => setSelected(n), []);
  const [width, setWidth] = useState(() => innerWidth);
  const [simulate, setSimulate] = useState(false);
  const [previewFit, setPreviewFit] = useState(true);
  const desktopCommentsVisible = width >= 1024 && commentsOpen;
  const fileSidebarBounds = {
    min: FILE_SIDEBAR_MIN_WIDTH_PX,
    max: Math.max(
      FILE_SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        FILE_SIDEBAR_MAX_WIDTH_PX,
        width - (desktopCommentsVisible ? commentSidebarWidth : 0) - REVIEW_AREA_MIN_WIDTH_PX,
      ),
    ),
  };
  const visibleFileSidebarWidth = clampSidebarWidth(fileSidebarWidth, fileSidebarBounds);
  const commentSidebarBounds = {
    min: COMMENT_SIDEBAR_MIN_WIDTH_PX,
    max: Math.max(
      COMMENT_SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        COMMENT_SIDEBAR_MAX_WIDTH_PX,
        width - visibleFileSidebarWidth - REVIEW_AREA_MIN_WIDTH_PX,
      ),
    ),
  };
  const visibleCommentSidebarWidth = clampSidebarWidth(commentSidebarWidth, commentSidebarBounds);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("patchwork-theme", theme);
  }, [theme]);
  useEffect(() => {
    const update = () => setWidth(innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const choose = useCallback(
    (n: number) => {
      if (n < 0 || n >= data.files.length) return;
      setDrawer(false);
      diffRef.current?.scrollToFile(n);
    },
    [data.files.length],
  );
  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "mocha" ? "latte" : "mocha"));
  }, []);
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
      )
        return;
      if (e.key === "j" || (e.key === "ArrowDown" && e.shiftKey)) {
        e.preventDefault();
        choose(Math.min(selected + 1, data.files.length - 1));
      }
      if (e.key === "k" || (e.key === "ArrowUp" && e.shiftKey)) {
        e.preventDefault();
        choose(Math.max(selected - 1, 0));
      }
      if (e.key === "v") setMode((m) => (m === "split" ? "unified" : "split"));
      if (e.key === "t") toggleTheme();
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [selected, data.files.length, choose, toggleTheme]);
  const sidebar = (
    <>
      <div className="side-heading">
        <div>
          Changed files <span className="count">{data.files.length}</span>
        </div>
        <FileDiff style={{ color: "var(--overlay)", width: 15 }} />
      </div>
      <Stats files={data.files} />
      <div className="review-progress">
        <span>
          {progress.viewed.filter(Boolean).length} / {data.files.length} viewed
        </span>
        <span
          className="auto-label"
          title="Files are marked viewed after every diff line has been visible."
        >
          Auto
        </span>
      </div>
      <FileTree
        files={data.files}
        selected={selected}
        onSelect={choose}
        viewed={progress.viewed}
        onToggle={progress.toggle}
        ready={model.meta.length > 0}
      />
      <div className="side-bottom">
        <Terminal />
        <span>{data.repository}</span>
      </div>
    </>
  );
  if (simulate && width < 768 && !embedded) {
    const scale = previewFit ? width / 1440 : 1;
    return (
      <>
        <div className="desktop-preview-bar">
          <span>
            <Monitor style={{ display: "inline", marginRight: 6 }} />
            1440 × 900
          </span>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="control" onClick={() => setPreviewFit(!previewFit)}>
              {previewFit ? "Zoom 100%" : "Fit screen"}
            </button>
            <button
              className="control"
              onClick={() => {
                setSimulate(false);
                void runtime.reload();
              }}
            >
              <Smartphone />
              Mobile
            </button>
          </div>
        </div>
        <div
          className="simulated-viewport"
          style={{
            height: "calc(100dvh - 45px)",
            overflow: "auto",
            background: "var(--crust)",
          }}
        >
          <div style={{ width: 1440 * scale, height: 900 * scale }}>
            <iframe
              title="Desktop diff preview"
              src={`/?desktop=1&theme=${theme}`}
              style={{
                width: 1440,
                height: 900,
                border: 0,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </>
    );
  }
  return (
    <CommentContext.Provider value={comments}>
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Superreview home">
            <GitCompareArrows />
            superreview
          </a>
          <div className="top-divider" />
          <div className="repo-label">
            <Folder />
            {data.repository}
            <span className="branch">
              <GitBranch />
              {data.branch}
            </span>
          </div>
          <div className="top-actions">
            {!embedded && (
              <button
                className="control mobile-only"
                onClick={() => setSimulate(true)}
                title="Simulate desktop on mobile"
              >
                <Monitor />
                <span>Desktop preview</span>
              </button>
            )}
            <button
              className="control"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "mocha" ? "Latte light" : "Mocha dark"} theme`}
            >
              {theme === "mocha" ? <Moon /> : <Sun />}
              <span>{theme === "mocha" ? "Mocha" : "Latte"}</span>
            </button>
          </div>
        </header>
        <div className="workspace">
          <SidebarProvider>
            <Sidebar
              id="file-sidebar"
              className="file-sidebar"
              collapsible="none"
              style={
                {
                  "--file-sidebar-width": `${visibleFileSidebarWidth}px`,
                } as CSSProperties
              }
            >
              {sidebar}
              <SidebarResizer
                controls="file-sidebar"
                label="Resize file sidebar"
                value={visibleFileSidebarWidth}
                bounds={fileSidebarBounds}
                growDirection={1}
                onChange={setFileSidebarWidth}
              />
            </Sidebar>
            <Sheet open={drawer} onOpenChange={setDrawer}>
              <SheetContent side="left" className="file-sheet">
                <SheetHeader className="sr-only">
                  <SheetTitle>Changed files</SheetTitle>
                  <SheetDescription>Select a file to review its changes.</SheetDescription>
                </SheetHeader>
                {sidebar}
              </SheetContent>
            </Sheet>
            <main className="review-area">
              <div className="review-heading">
                <div>
                  <div className="review-title">
                    <h1>{runtime.session!.state.identity.title}</h1>
                    <span className="count">{data.files.length}</span>
                  </div>
                  <div className="review-subtitle">
                    {runtime.session!.snapshot.label} <span style={{ margin: "0 5px" }}> / </span>{" "}
                    {data.branch}
                  </div>
                </div>
                <div className="review-heading-actions">
                  <button
                    className={`control comments-toggle ${commentsOpen && width >= 1024 ? "active" : ""}`}
                    aria-label="Toggle comments overview"
                    aria-expanded={width < 1024 ? commentDrawer : commentsOpen}
                    onClick={() =>
                      width < 1024 ? setCommentDrawer(true) : setCommentsOpen(!commentsOpen)
                    }
                  >
                    <MessageSquare />
                    Comments
                    <span className="count">{comments.threads.length}</span>
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <button
                  className="icon-button mobile-only"
                  onClick={() => setDrawer(true)}
                  aria-label="Open file tree"
                >
                  <PanelLeft />
                </button>
                <Tabs value={mode} onValueChange={setMode} className="mode-tabs">
                  <TabsList aria-label="Diff layout">
                    <TabsTrigger value="unified">
                      <Rows3 />
                      Unified
                    </TabsTrigger>
                    <TabsTrigger value="split">
                      <Columns2 />
                      Split
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="toolbar-right">
                  <button
                    className={`icon-button ${words ? "active" : ""}`}
                    onClick={() => setWords(!words)}
                    aria-label="Toggle word highlights"
                    aria-pressed={words}
                    title="Word highlights"
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                      }}
                    >
                      ab
                    </span>
                  </button>
                  <span className="word-label desktop-only">Word diff</span>
                  <button
                    className={`icon-button ${wrap ? "active" : ""}`}
                    onClick={() => setWrap(!wrap)}
                    aria-label="Toggle line wrapping"
                    aria-pressed={wrap}
                    title="Wrap long lines"
                  >
                    <WrapText />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    disabled={selected === 0}
                    onClick={() => choose(selected - 1)}
                    aria-label="Previous file"
                    title="Previous file · K"
                  >
                    <ArrowUp />
                  </button>
                  <span className="file-position">
                    {data.files.length ? selected + 1 : 0} / {data.files.length}
                  </span>
                  <button
                    className="icon-button"
                    disabled={selected >= data.files.length - 1}
                    onClick={() => choose(selected + 1)}
                    aria-label="Next file"
                    title="Next file · J"
                  >
                    <ArrowDown />
                  </button>
                </div>
              </div>
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
                onActive={syncActive}
                getBlock={model.getBlock}
                request={model.request}
                version={model.version}
              />
            </main>
            {desktopCommentsVisible && (
              <aside
                id="comments-sidebar"
                className="comments-sidebar"
                style={{ width: visibleCommentSidebarWidth }}
                aria-label="Comments overview"
              >
                <SidebarResizer
                  controls="comments-sidebar"
                  label="Resize comments sidebar"
                  value={visibleCommentSidebarWidth}
                  bounds={commentSidebarBounds}
                  growDirection={-1}
                  onChange={setCommentSidebarWidth}
                />
                <CommentOverview
                  selected={selected}
                  onJump={jumpComment}
                  onClose={() => setCommentsOpen(false)}
                />
              </aside>
            )}
            <Sheet open={commentDrawer && width < 1024} onOpenChange={setCommentDrawer}>
              <SheetContent side="right" className="comments-sheet" showCloseButton={false}>
                <SheetHeader className="sr-only">
                  <SheetTitle>Comments</SheetTitle>
                  <SheetDescription>Browse comments across all changed files.</SheetDescription>
                </SheetHeader>
                <CommentOverview
                  selected={selected}
                  onJump={jumpComment}
                  onClose={() => setCommentDrawer(false)}
                />
              </SheetContent>
            </Sheet>
            <MobileComposer mobile={width < 768} />
          </SidebarProvider>
        </div>
        <footer className="statusbar">
          <span>
            <GitBranch />
            {data.branch}
          </span>
          <span className="desktop-only">{data.files.length} changed files</span>
          <div className="status-right">
            <span className="shortcut desktop-only">
              <kbd>J</kbd>
              <kbd>K</kbd> files
            </span>
            <span className="shortcut desktop-only">
              <kbd>V</kbd> view
            </span>
            <span className="desktop-only">UTF-8</span>
            <span>Catppuccin {theme === "mocha" ? "Mocha" : "Latte"}</span>
            <span className="desktop-only">Local snapshot</span>
          </div>
        </footer>
        <CommentFeedback />
      </div>
    </CommentContext.Provider>
  );
}
