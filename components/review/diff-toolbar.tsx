import { ArrowDown, ArrowUp, Columns2, PanelLeft, Rows3, WrapText } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FileNavigation } from "@/lib/diff/file-order";

export type DiffMode = "unified" | "split";

export function DiffToolbar({
  mode,
  wordHighlights,
  wrapLines,
  navigation,
  onModeChange,
  onOpenFiles,
  onToggleWordHighlights,
  onToggleWrapLines,
  onSelectFile,
}: {
  mode: DiffMode;
  wordHighlights: boolean;
  wrapLines: boolean;
  navigation: FileNavigation;
  onModeChange: (mode: DiffMode) => void;
  onOpenFiles: () => void;
  onToggleWordHighlights: () => void;
  onToggleWrapLines: () => void;
  onSelectFile: (file: number) => void;
}) {
  return (
    <div className="toolbar">
      <button className="icon-button mobile-only" onClick={onOpenFiles} aria-label="Open file tree">
        <PanelLeft />
      </button>
      <Tabs
        value={mode}
        onValueChange={(value) => onModeChange(value as DiffMode)}
        className="mode-tabs"
      >
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
          className={`icon-button ${wordHighlights ? "active" : ""}`}
          onClick={onToggleWordHighlights}
          aria-label="Toggle word highlights"
          aria-pressed={wordHighlights}
          title="Word highlights"
        >
          <span className="word-diff-symbol">ab</span>
        </button>
        <span className="word-label desktop-only">Word diff</span>
        <button
          className={`icon-button ${wrapLines ? "active" : ""}`}
          onClick={onToggleWrapLines}
          aria-label="Toggle line wrapping"
          aria-pressed={wrapLines}
          title="Wrap long lines"
        >
          <WrapText />
        </button>
        <span className="toolbar-divider" />
        <button
          className="icon-button"
          disabled={navigation.previous === undefined}
          onClick={() => navigation.previous !== undefined && onSelectFile(navigation.previous)}
          aria-label="Previous file"
          title="Previous file · K"
        >
          <ArrowUp />
        </button>
        <span className="file-position">
          {navigation.position} / {navigation.count}
        </span>
        <button
          className="icon-button"
          disabled={navigation.next === undefined}
          onClick={() => navigation.next !== undefined && onSelectFile(navigation.next)}
          aria-label="Next file"
          title="Next file · J"
        >
          <ArrowDown />
        </button>
      </div>
    </div>
  );
}
