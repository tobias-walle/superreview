import { useState, type CSSProperties } from "react";
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
import type { ReviewFile } from "@/lib/diff/render";

const DIFF_METER_SEGMENTS = 7;

function ChangeStats({ files }: { files: ReviewFile[] }) {
  return (
    <div className="change-summary">
      <span className="stat plus">+{files.reduce((sum, file) => sum + file.additions, 0)}</span>
      <span className="stat minus">−{files.reduce((sum, file) => sum + file.deletions, 0)}</span>
      <span>lines changed</span>
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
}) {
  return (
    <>
      <div className="side-heading">
        <div>
          Changed files <span className="count">{files.length}</span>
        </div>
        <FileDiff className="side-heading-icon" />
      </div>
      <ChangeStats files={files} />
      <div className="review-progress">
        <span title="Files are marked viewed after every diff line has been visible.">
          {viewed.filter(Boolean).length} / {files.length} viewed
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
      <FileTree
        files={files}
        selected={selected}
        onSelect={onSelect}
        viewed={viewed}
        onToggle={onToggleViewed}
        readyFiles={readyFiles}
        unseenOnly={unseenOnly}
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
