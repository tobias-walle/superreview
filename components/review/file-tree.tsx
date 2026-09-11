import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { useComments } from "@/hooks/use-comments";
import { MessageSquare } from "lucide-react";
import { FileIcon } from "./code";
import type { ReviewFile } from "@/lib/diff/render";
import { buildFileTreeEntries } from "@/lib/diff/file-order";

const TREE_ROW_HEIGHT_PX = 34;
const TREE_DEPTH_INDENT_PX = 15;
const TREE_OVERSCAN_ROWS = 8;

type TreeIndentStyle = CSSProperties & { "--tree-indent": string };

function treeIndent(depth: number): TreeIndentStyle {
  return { "--tree-indent": `${depth * TREE_DEPTH_INDENT_PX}px` };
}

export function FileTree({
  files,
  selected,
  onSelect,
  viewed,
  onToggle,
  readyFiles,
  unseenOnly,
}: {
  files: ReviewFile[];
  selected: number;
  onSelect: (n: number) => void;
  viewed: boolean[];
  onToggle: (n: number, value: boolean) => void;
  readyFiles: number;
  unseenOnly: boolean;
}) {
  const comments = useComments();
  const root = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState(new Set<string>());
  const entries = useMemo(
    () =>
      buildFileTreeEntries(
        files.map((file) => file.path),
        closed,
        (file) => !unseenOnly || !viewed[file],
      ),
    [files, closed, unseenOnly, viewed],
  );
  // TanStack Virtual exposes callbacks React Compiler cannot memoize safely.
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => root.current,
    estimateSize: () => TREE_ROW_HEIGHT_PX,
    overscan: TREE_OVERSCAN_ROWS,
    getItemKey: (i) => entries[i].key,
  });
  useEffect(() => {
    const parts = files[selected]?.path.split("/") || [];
    setClosed((old) => {
      const next = new Set(old);
      for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join("/"));
      return next.size === old.size ? old : next;
    });
  }, [selected, files]);
  useEffect(() => {
    const i = entries.findIndex((entry) => entry.kind === "file" && entry.file === selected);
    if (i >= 0) virtual.scrollToIndex(i, { align: "auto" });
  }, [selected, entries, virtual]);
  return (
    <div className="tree virtual-tree" ref={root} aria-label="Changed file tree">
      {entries.length === 0 ? (
        <div className="tree-empty">All files viewed</div>
      ) : (
        <SidebarMenu
          style={{
            height: virtual.getTotalSize(),
            position: "relative",
            display: "block",
          }}
        >
          {virtual.getVirtualItems().map((item) => {
            const e = entries[item.index];
            return (
              <SidebarMenuItem
                key={e.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: TREE_ROW_HEIGHT_PX,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {e.kind === "folder" ? (
                  <>
                    <button
                      className="folder-button"
                      style={treeIndent(e.depth)}
                      aria-expanded={!closed.has(e.path)}
                      title={e.path}
                      onClick={() =>
                        setClosed((old) => {
                          const next = new Set(old);
                          if (next.has(e.path)) next.delete(e.path);
                          else next.add(e.path);
                          return next;
                        })
                      }
                    >
                      {closed.has(e.path) ? <ChevronRight /> : <ChevronDown />}
                      <Folder />
                      <span className="tree-entry-label">{e.label}</span>
                      <span className="folder-count">{e.count}</span>
                    </button>
                    <Checkbox
                      className="tree-viewed tree-folder-viewed"
                      checked={
                        e.files.every((file) => viewed[file])
                          ? true
                          : e.files.some((file) => viewed[file])
                            ? "indeterminate"
                            : false
                      }
                      disabled={e.files.some((file) => file >= readyFiles)}
                      onCheckedChange={(value) =>
                        e.files.forEach((file) => onToggle(file, value === true))
                      }
                      aria-label={`Viewed folder ${e.path}`}
                      title={
                        e.files.every((file) => viewed[file])
                          ? "Mark folder unviewed"
                          : "Mark folder viewed"
                      }
                    />
                  </>
                ) : (
                  <>
                    <SidebarMenuButton
                      className={`tree-file ${viewed[e.file] ? "is-viewed" : ""}`}
                      isActive={selected === e.file}
                      aria-current={selected === e.file ? "true" : undefined}
                      style={treeIndent(e.depth)}
                      onClick={() => onSelect(e.file)}
                      title={files[e.file].path}
                    >
                      <FileIcon path={e.key} />
                      <span className="tree-entry-label">{e.key.split("/").at(-1)}</span>
                      {files[e.file].changedSinceReview && !viewed[e.file] && (
                        <span
                          className="changed-indicator"
                          title="Changed since review"
                          aria-label="Changed since review"
                        >
                          •
                        </span>
                      )}
                      {comments.counts.get(e.key) ? (
                        <span
                          className="tree-comment-count"
                          title={`${comments.counts.get(e.key)} comment threads`}
                        >
                          <MessageSquare />
                          {comments.counts.get(e.key)}
                        </span>
                      ) : null}
                      <span className={`file-status ${files[e.file].status}`}>
                        {files[e.file].status}
                      </span>
                    </SidebarMenuButton>
                    <Checkbox
                      className="tree-viewed"
                      checked={!!viewed[e.file]}
                      disabled={e.file >= readyFiles}
                      onCheckedChange={(value) => onToggle(e.file, value === true)}
                      aria-label={`Viewed ${files[e.file].path}`}
                      title={viewed[e.file] ? "Mark unviewed" : "Mark viewed"}
                    />
                  </>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </div>
  );
}
