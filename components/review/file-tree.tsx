import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { useComments } from "@/hooks/use-comments";
import { MessageSquare } from "lucide-react";
import { FileIcon } from "./code";
import type { ReviewFile } from "@/lib/diff/render";
type Entry = {
  key: string;
  folder?: string;
  depth: number;
  file?: number;
  count?: number;
};
export function FileTree({
  files,
  selected,
  onSelect,
  viewed,
  onToggle,
  ready,
}: {
  files: ReviewFile[];
  selected: number;
  onSelect: (n: number) => void;
  viewed: boolean[];
  onToggle: (n: number, value: boolean) => void;
  ready: boolean;
}) {
  const comments = useComments();
  const root = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState(new Set<string>());
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of files) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const p = parts.slice(0, i).join("/");
        map.set(p, (map.get(p) || 0) + 1);
      }
    }
    return map;
  }, [files]);
  const entries = useMemo(() => {
    const list: Entry[] = [];
    const seen = new Set<string>();
    files.forEach((f, i) => {
      const parts = f.path.split("/");
      let hidden = false;
      parts.slice(0, -1).forEach((name, depth) => {
        const path = parts.slice(0, depth + 1).join("/");
        if (!hidden && !seen.has(path)) {
          seen.add(path);
          list.push({
            key: "folder:" + path,
            folder: name,
            depth,
            count: counts.get(path),
          });
        }
        if (closed.has(path)) hidden = true;
      });
      if (!hidden) list.push({ key: f.path, file: i, depth: parts.length - 1 });
    });
    return list;
  }, [files, closed, counts]);
  // TanStack Virtual exposes callbacks React Compiler cannot memoize safely.
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => root.current,
    estimateSize: () => 34,
    overscan: 8,
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
    const i = entries.findIndex((e) => e.file === selected);
    if (i >= 0) virtual.scrollToIndex(i, { align: "auto" });
  }, [selected, entries, virtual]);
  return (
    <div className="tree virtual-tree" ref={root} aria-label="Changed file tree">
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
                height: 34,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {e.folder ? (
                <button
                  className="folder-button"
                  style={{ paddingLeft: 8 + e.depth * 15 }}
                  aria-expanded={!closed.has(e.key.slice(7))}
                  onClick={() =>
                    setClosed((old) => {
                      const n = new Set(old),
                        p = e.key.slice(7);
                      if (n.has(p)) n.delete(p);
                      else n.add(p);
                      return n;
                    })
                  }
                >
                  {closed.has(e.key.slice(7)) ? <ChevronRight /> : <ChevronDown />}
                  <Folder />
                  <span>{e.folder}</span>
                  <span className="folder-count">{e.count}</span>
                </button>
              ) : (
                <>
                  <SidebarMenuButton
                    disabled={!ready}
                    className={`tree-file ${viewed[e.file!] ? "is-viewed" : ""}`}
                    isActive={selected === e.file}
                    aria-current={selected === e.file ? "true" : undefined}
                    style={{ paddingLeft: 14 + e.depth * 15, paddingRight: 34 }}
                    onClick={() => onSelect(e.file!)}
                    title={files[e.file!].path}
                  >
                    <FileIcon path={e.key} />
                    <span>{e.key.split("/").at(-1)}</span>
                    {files[e.file!].changedSinceReview && !viewed[e.file!] && (
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
                    <span className={`file-status ${files[e.file!].status}`}>
                      {files[e.file!].status}
                    </span>
                  </SidebarMenuButton>
                  <Checkbox
                    className="tree-viewed"
                    checked={!!viewed[e.file!]}
                    disabled={!ready}
                    onCheckedChange={(v) => onToggle(e.file!, v === true)}
                    aria-label={`Viewed ${files[e.file!].path}`}
                    title={viewed[e.file!] ? "Mark unviewed" : "Mark viewed"}
                  />
                </>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </div>
  );
}
