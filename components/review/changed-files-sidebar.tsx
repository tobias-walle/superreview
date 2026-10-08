import { useState, type CSSProperties, type ReactNode } from "react";
import { EyeOff, FileDiff, Terminal } from "lucide-react";

import { FileTree } from "@/components/review/file-tree";
import { SidebarResizer, type ResizeBounds } from "@/components/review/sidebar-resizer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Sidebar } from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import type { ReviewFile } from "@/lib/diff/render";

const DIFF_METER_SEGMENTS = 7;

export function GuideScopeSelector({
  chunks,
  reads,
  selectedChunkId,
  loading,
  onSelect,
  onGuided,
  onRead,
  readDisabled,
}: {
  chunks: readonly { id: string; title: string }[];
  reads: Record<string, boolean>;
  selectedChunkId: string | null;
  loading: boolean;
  onSelect: (chunkId: string | null) => void;
  onGuided: () => void;
  onRead: (chunkId: string, read: boolean) => void;
  readDisabled: boolean;
}) {
  return (
    <div className="guide-scope-selector">
      <div className="review-view-switch" role="group" aria-label="Review scope">
        <button
          className={selectedChunkId ? "selected" : ""}
          aria-pressed={!!selectedChunkId}
          disabled={!chunks.length}
          onClick={onGuided}
        >
          Guided
        </button>
        <button
          className={!selectedChunkId ? "selected" : ""}
          aria-pressed={!selectedChunkId}
          onClick={() => onSelect(null)}
        >
          All files
        </button>
      </div>
      {loading && <p role="status">Opening guide…</p>}
      {selectedChunkId && (
        <ol aria-label="Guide chunks" className="guide-chunks">
          {chunks.map((chunk) => {
            const read = reads[chunk.id] === true;
            return (
              <li key={chunk.id} className="guide-chunk-row">
                <button
                  className="guide-chunk-select"
                  aria-current={selectedChunkId === chunk.id ? "true" : undefined}
                  onClick={() => onSelect(chunk.id)}
                  title={chunk.title}
                >
                  <span>{chunk.title}</span>
                </button>
                <Checkbox
                  className="guide-chunk-read"
                  checked={read}
                  disabled={readDisabled}
                  onCheckedChange={(value) => onRead(chunk.id, value === true)}
                  aria-label={`${read ? "Mark unread" : "Mark read"}: ${chunk.title}`}
                  title={`${read ? "Mark chunk unread" : "Mark chunk read"}. This does not mark files viewed or approve changes.`}
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ChangeStats({ files, partialScope }: { files: ReviewFile[]; partialScope: boolean }) {
  return (
    <div className={`change-summary ${partialScope ? "partial-change-summary" : ""}`}>
      <span className="stat plus">+{files.reduce((sum, file) => sum + file.additions, 0)}</span>
      <span className="stat minus">−{files.reduce((sum, file) => sum + file.deletions, 0)}</span>
      <span>{partialScope ? "full captured-file totals" : "lines changed"}</span>
      <div className="diff-meter" aria-hidden="true">
        {Array.from({ length: DIFF_METER_SEGMENTS }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    </div>
  );
}

function ChangedFilesContent({
  files,
  repository,
  selected,
  viewed,
  readyFiles,
  unseenOnly,
  onSelect,
  onToggleViewed,
  onUnseenOnlyChange,
  scopeIndices,
  partialScope,
  guideSelector,
}: {
  files: ReviewFile[];
  repository: string;
  selected: number;
  viewed: boolean[];
  readyFiles: number;
  unseenOnly: boolean;
  onSelect: (file: number) => void;
  onToggleViewed: (file: number, viewed: boolean) => void;
  onUnseenOnlyChange: (enabled: boolean) => void;
  scopeIndices: readonly number[];
  partialScope: boolean;
  guideSelector?: ReactNode;
}) {
  const scopedFiles = scopeIndices.map((index) => files[index]);
  const viewedCount = scopeIndices.filter((index) => viewed[index]).length;
  return (
    <>
      <div className="side-heading">
        <div>
          Changed files <span className="count">{scopeIndices.length}</span>
        </div>
        <FileDiff className="side-heading-icon" />
      </div>
      <ChangeStats files={scopedFiles} partialScope={partialScope} />
      <div className="review-progress">
        <span title="Files are marked viewed after every diff line has been visible.">
          {viewedCount} / {scopeIndices.length} viewed
        </span>
        <button
          type="button"
          className="unseen-filter"
          aria-pressed={unseenOnly}
          title="Show only unseen files"
          onClick={() => onUnseenOnlyChange(!unseenOnly)}
        >
          <EyeOff />
          Unseen
        </button>
      </div>
      {guideSelector}
      <FileTree
        files={files}
        selected={selected}
        onSelect={onSelect}
        viewed={viewed}
        onToggle={onToggleViewed}
        readyFiles={readyFiles}
        unseenOnly={unseenOnly}
        scopeIndices={scopeIndices}
      />
      <div className="side-bottom">
        <Terminal />
        <span>{repository}</span>
      </div>
    </>
  );
}

export function ChangedFilesSidebar({
  files,
  repository,
  selected,
  viewed,
  readyFiles,
  drawerOpen,
  width,
  resizeBounds,
  onSelect,
  onToggleViewed,
  onDrawerChange,
  onResize,
  scopeIndices,
  partialScope = false,
  guideSelector,
}: {
  files: ReviewFile[];
  repository: string;
  selected: number;
  viewed: boolean[];
  readyFiles: number;
  drawerOpen: boolean;
  width: number;
  resizeBounds: ResizeBounds;
  onSelect: (file: number) => void;
  onToggleViewed: (file: number, viewed: boolean) => void;
  onDrawerChange: (open: boolean) => void;
  onResize: (width: number) => void;
  scopeIndices: readonly number[];
  partialScope?: boolean;
  guideSelector?: ReactNode;
}) {
  const [unseenOnly, setUnseenOnly] = useState(false);
  const content = (
    <ChangedFilesContent
      files={files}
      repository={repository}
      selected={selected}
      viewed={viewed}
      readyFiles={readyFiles}
      unseenOnly={unseenOnly}
      onSelect={onSelect}
      onToggleViewed={onToggleViewed}
      onUnseenOnlyChange={setUnseenOnly}
      scopeIndices={scopeIndices}
      partialScope={partialScope}
      guideSelector={guideSelector}
    />
  );

  return (
    <>
      <Sidebar
        id="file-sidebar"
        className="file-sidebar"
        collapsible="none"
        style={{ "--file-sidebar-width": `${width}px` } as CSSProperties}
      >
        {content}
        <SidebarResizer
          controls="file-sidebar"
          label="Resize file sidebar"
          value={width}
          bounds={resizeBounds}
          growDirection={1}
          onChange={onResize}
        />
      </Sidebar>
      <Sheet open={drawerOpen} onOpenChange={onDrawerChange}>
        <SheetContent side="left" className="file-sheet">
          <SheetHeader className="sr-only">
            <SheetTitle>Changed files</SheetTitle>
            <SheetDescription>Select a file to review its changes.</SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    </>
  );
}
