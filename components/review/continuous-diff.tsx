import {
  Fragment,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight, Copy, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LineThreads } from "./comments";
import type { Anchor } from "@/lib/comments/model";
import { Cell, FileIcon } from "./code";
import { useLineVisibility } from "@/hooks/use-line-visibility";
import { useSyntaxHighlighting } from "@/hooks/use-syntax-highlighting";
import type { BlockMeta, FileMeta, ReviewFile, RowPair } from "@/lib/diff/render";
import type { Evidence } from "@/lib/review/types";
export type DiffHandle = {
  scrollToFile: (index: number) => void;
  scrollToAnchor: (anchor: Anchor) => void;
};
type Item = {
  key: string;
  kind: "header" | "hunk" | "block" | "end" | "binary";
  file: number;
  hunk?: number;
  block?: number;
  meta?: BlockMeta;
};
const MOBILE_VIEWPORT_MAX_WIDTH_PX = 767;
const DESKTOP_FILE_HEADER_GAP_PX = 18;
const MOBILE_FILE_HEADER_GAP_PX = 14;
type Props = {
  preparationMs: number;
  files: ReviewFile[];
  evidence: Record<string, Evidence>;
  readContent: (object: string) => Promise<string>;
  meta: FileMeta[];
  error: string;
  mode: string;
  wrap: boolean;
  words: boolean;
  viewed: boolean[];
  manual: boolean[];
  version: number;
  getBlock: (key: string) => RowPair[] | undefined;
  request: (keys: string[]) => void;
  onActive: (file: number) => void;
  onToggle: (file: number, value: boolean) => void;
  onResume: (file: number) => void;
  markSeen: (file: number, hunk: number, rows: number[]) => void;
};
const CodeBlock = memo(function CodeBlock({
  rows,
  file,
  hunk,
  reviewFile,
  mode,
  wrap,
  words,
  evidence,
  readContent,
}: {
  rows: RowPair[];
  file: number;
  hunk: number;
  reviewFile: ReviewFile;
  mode: string;
  wrap: boolean;
  words: boolean;
  evidence: Evidence;
  readContent: Props["readContent"];
}) {
  const sourceObjects = reviewFile.sourceObjects || {
    old: evidence.before.object,
    new: evidence.after.object,
  };
  const highlight = useSyntaxHighlighting(
    reviewFile.path,
    reviewFile.hunks[hunk],
    sourceObjects.old,
    sourceObjects.new,
    readContent,
  );
  const max = Math.max(
    0,
    ...rows.map(([a, b]) => Math.max(a?.text.length || 0, b?.text.length || 0)),
  );
  return (
    <div className={`stream-block ${mode}`}>
      <div
        className={`code-table ${wrap ? "wrap" : ""}`}
        style={
          !wrap
            ? {
                minWidth: mode === "split" ? max * 14.6 + 130 : max * 7.3 + 100,
              }
            : undefined
        }
      >
        {rows.map((r, i) => (
          <Fragment key={i}>
            <div
              className="code-row"
              data-review-line={`${file}/${hunk}/${[...new Set(r.filter(Boolean).map((l) => l!.sourceIndex))].join(",")}`}
            >
              <Cell
                line={r[0]}
                words={words}
                unified={mode === "unified"}
                file={file}
                hunk={hunk}
                side="old"
                highlight={highlight}
              />
              {mode === "split" && (
                <Cell
                  line={r[1]}
                  words={words}
                  file={file}
                  hunk={hunk}
                  side="new"
                  highlight={highlight}
                />
              )}
            </div>
            <LineThreads
              file={file}
              hunk={hunk}
              sources={[...new Set(r.filter(Boolean).map((l) => l!.sourceIndex))]}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
});
function FilePath({ path }: { path: string }) {
  return (
    <div className="file-path" title={path}>
      <span>{path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""}</span>
      {path.split("/").at(-1)}
    </div>
  );
}
function ViewedControl({
  file,
  path,
  viewed,
  manual,
  onToggle,
  onResume,
}: {
  file: number;
  path: string;
  viewed: boolean;
  manual: boolean;
  onToggle: Props["onToggle"];
  onResume: Props["onResume"];
}) {
  return (
    <div className="viewed-control">
      <label
        title={
          manual && !viewed
            ? "Manually marked unviewed. Automatic marking is paused."
            : "Marks viewed after all diff lines have been visible."
        }
      >
        <Checkbox
          className="viewed-checkbox"
          checked={viewed}
          onCheckedChange={(v) => onToggle(file, v === true)}
          aria-label={`Viewed ${path}`}
        />
        <span>Viewed</span>
      </label>
      {manual && !viewed && (
        <button
          className="icon-button resume-auto"
          onClick={() => onResume(file)}
          title="Resume automatic viewed tracking"
          aria-label={`Resume automatic tracking for ${path}`}
        >
          <RotateCcw />
        </button>
      )}
    </div>
  );
}
function FileHeader({
  fileIndex,
  file,
  collapsed,
  viewed,
  manual,
  copied,
  className = "",
  onToggleCollapsed,
  onToggleViewed,
  onResume,
  onCopy,
}: {
  fileIndex: number;
  file: ReviewFile;
  collapsed: boolean;
  viewed: boolean;
  manual: boolean;
  copied: boolean;
  className?: string;
  onToggleCollapsed: (file: number) => void;
  onToggleViewed: Props["onToggle"];
  onResume: Props["onResume"];
  onCopy: (file: number, path: string) => void;
}) {
  return (
    <div className={`file-header ${className}`}>
      <button
        className="icon-button"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.path}`}
        aria-expanded={!collapsed}
        onClick={() => onToggleCollapsed(fileIndex)}
      >
        {collapsed ? <ChevronRight /> : <ChevronDown />}
      </button>
      <FileIcon path={file.path} />
      <FilePath path={file.path} />
      {file.changedSinceReview && !viewed && (
        <span className="changed-badge">Changed since review</span>
      )}
      {file.changeSummary && (
        <span className="file-change-summary" title={file.changeSummary}>
          {file.changeSummary}
        </span>
      )}
      <div className="stats">
        <span className="stat plus">+{file.additions}</span>
        <span className="stat minus">−{file.deletions}</span>
      </div>
      <ViewedControl
        file={fileIndex}
        path={file.path}
        viewed={viewed}
        manual={manual}
        onToggle={onToggleViewed}
        onResume={onResume}
      />
      <button
        className="icon-button copy-path"
        aria-label={`Copy path ${file.path}`}
        onClick={() => onCopy(fileIndex, file.path)}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  );
}
export const ContinuousDiff = forwardRef<DiffHandle, Props>(function ContinuousDiff(props, ref) {
  const {
    files,
    meta,
    mode,
    wrap,
    words,
    viewed,
    manual,
    onToggle,
    onResume,
    onActive,
    markSeen,
    getBlock,
    request,
    version,
    error,
    evidence,
    readContent,
  } = props;
  const root = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(new Set<number>());
  const [width, setWidth] = useState(1000);
  const [pendingComment, setPendingComment] = useState<Anchor | null>(null);
  const [copied, setCopied] = useState(-1);
  const anchor = useRef<Item | undefined>(undefined);
  const previousLayout = useRef("");
  const navigationTarget = useRef<number | undefined>(undefined);
  const toggleCollapsed = useCallback((file: number) => {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);
  const copyPath = useCallback(async (file: number, path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(file);
      setTimeout(() => setCopied(-1), 1200);
    } catch {}
  }, []);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const { items, starts } = useMemo(() => {
    const items: Item[] = [],
      starts: number[] = [];
    meta.forEach((file, fi) => {
      starts.push(items.length);
      items.push({ key: `${fi}:header`, kind: "header", file: fi });
      if (collapsed.has(fi)) return;
      if (files[fi].binary) items.push({ key: `${fi}:binary`, kind: "binary", file: fi });
      file.hunks.forEach((h, hi) => {
        items.push({
          key: `${fi}:${hi}:hunk`,
          kind: "hunk",
          file: fi,
          hunk: hi,
        });
        const blocks = mode === "split" ? h.split : h.unified;
        blocks.forEach((block, bi) =>
          items.push({
            key: `${fi}:${hi}:${mode}:${bi}`,
            kind: "block",
            file: fi,
            hunk: hi,
            block: bi,
            meta: block,
          }),
        );
      });
      items.push({ key: `${fi}:end`, kind: "end", file: fi });
    });
    return { items, starts };
  }, [meta, files, mode, collapsed]);
  const estimate = useCallback(
    (i: number) => {
      const item = items[i];
      if (item.kind === "header")
        return (
          64 + (mode === "split" && !collapsed.has(item.file) && !files[item.file].binary ? 29 : 0)
        );
      if (item.kind === "hunk") return 31;
      if (item.kind === "end") return 32;
      if (item.kind === "binary") return 96;
      const narrow = width < 700;
      const lineHeight = mode === "split" && narrow ? 21 : 23;
      const contentWidth = width - (narrow ? 20 : 56),
        gutter = mode === "split" ? (narrow ? 35 : 58) : 78;
      const chars = Math.max(
        8,
        ((mode === "split" ? contentWidth / 2 : contentWidth) - gutter - 12) /
          (mode === "split" && narrow ? 6.6 : 7.3),
      );
      return item.meta!.lengths.reduce(
        (s, n) => s + lineHeight * (wrap ? Math.max(1, Math.ceil(n / chars)) : 1),
        0,
      );
    },
    [items, width, mode, wrap, collapsed, files],
  );
  // TanStack Virtual exposes callbacks React Compiler cannot memoize safely.
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => root.current,
    estimateSize: estimate,
    overscan: 3,
    getItemKey: useCallback((i: number) => items[i].key, [items]),
    paddingEnd: 24,
    useAnimationFrameWithResizeObserver: true,
  });
  const visible = virtual.getVirtualItems();
  const scrollTop = root.current?.scrollTop || 0;
  const topVirtualItem = visible.find((item) => item.end > scrollTop + 2);
  let stickyFileIndex: number | undefined;
  if (topVirtualItem) {
    const topItem = items[topVirtualItem.index];
    const headerGap =
      typeof window !== "undefined" && window.innerWidth <= MOBILE_VIEWPORT_MAX_WIDTH_PX
        ? MOBILE_FILE_HEADER_GAP_PX
        : DESKTOP_FILE_HEADER_GAP_PX;
    if (topItem.kind !== "header" || scrollTop >= topVirtualItem.start + headerGap) {
      stickyFileIndex = topItem.file;
    } else if (topVirtualItem.index > 0) {
      stickyFileIndex = items[topVirtualItem.index - 1].file;
    }
  }
  const stickyFile = stickyFileIndex === undefined ? undefined : files[stickyFileIndex];
  const keys = visible
    .filter((v) => items[v.index]?.kind === "block")
    .map((v) => items[v.index].key)
    .join("|");
  useEffect(() => {
    if (keys) request(keys.split("|"));
  }, [keys, request, version]);
  useEffect(() => {
    const scroll = root.current?.scrollTop || 0;
    const first = visible.find((v) => v.end > scroll + 2);
    if (first && items[first.index]) {
      anchor.current = items[first.index];
      const areas = new Map<number, number>();
      const bottom = scroll + (root.current?.clientHeight || 0);
      for (const v of visible) {
        const f = items[v.index]?.file;
        if (f === undefined) continue;
        const area = Math.max(0, Math.min(v.end, bottom) - Math.max(v.start, scroll));
        areas.set(f, (areas.get(f) || 0) + area);
      }
      let active = items[first.index].file,
        max = 0;
      for (const [f, area] of areas)
        if (area > max) {
          active = f;
          max = area;
        }
      if (navigationTarget.current !== undefined && (areas.get(navigationTarget.current) || 0) > 0)
        active = navigationTarget.current;
      onActive(active);
    }
  }, [visible, items, onActive]);
  const layout = `${mode}:${wrap}:${Math.round(width)}`;
  useLayoutEffect(() => {
    if (previousLayout.current && previousLayout.current !== layout) {
      const old = anchor.current;
      virtual.measure();
      const target = old
        ? items.findIndex(
            (i) =>
              i.file === old.file &&
              i.kind === old.kind &&
              i.hunk === old.hunk &&
              i.block === old.block,
          )
        : -1;
      if (target >= 0) virtual.scrollToIndex(target, { align: "start" });
    }
    previousLayout.current = layout;
  }, [layout, virtual, items]);
  useImperativeHandle(
    ref,
    () => ({
      scrollToAnchor(a) {
        const file = files.findIndex((candidate) => candidate.fingerprint === a.fingerprint);
        if (file < 0) return;
        navigationTarget.current = file;
        setCollapsed((old) => {
          const n = new Set(old);
          n.delete(file);
          return n;
        });
        if (a.kind === "file") {
          virtual.scrollToIndex(starts[file], { align: "start" });
          return;
        }
        setPendingComment(a);
      },
      scrollToFile(index) {
        navigationTarget.current = index;
        if (starts[index] === undefined) return;
        setCollapsed((old) => {
          if (!old.has(index)) return old;
          const next = new Set(old);
          next.delete(index);
          return next;
        });
        virtual.scrollToIndex(starts[index], { align: "start" });
      },
    }),
    [starts, virtual, files],
  );
  useEffect(() => {
    const target = navigationTarget.current;
    if (target !== undefined && starts[target] !== undefined)
      virtual.scrollToIndex(starts[target], { align: "start" });
  }, [starts, virtual]);
  useEffect(() => {
    if (!pendingComment) return;
    const a = pendingComment;
    const fi = meta.findIndex((m) => m.fingerprint === a.fingerprint);
    const index = items.findIndex(
      (i) =>
        i.file === fi &&
        i.kind === "block" &&
        i.hunk === a.end.hunk &&
        i.meta?.sources.includes(a.end.source),
    );
    if (index < 0) return;
    const pos = `${a.fingerprint}:${a.end.hunk}:${a.end.source}`;
    const el = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-comment-pos]") || [],
    ).find((e) => e.dataset.commentPos === pos);
    if (el && root.current) {
      root.current.scrollTop +=
        el.getBoundingClientRect().top - root.current.getBoundingClientRect().top - 72;
      setPendingComment(null);
    } else {
      virtual.scrollToIndex(index, { align: "start" });
      request([items[index].key]);
    }
  }, [pendingComment, items, meta, version, virtual, request, keys]);
  useLineVisibility(root, markSeen, layout);
  return (
    <div
      ref={root}
      onWheel={() => {
        navigationTarget.current = undefined;
      }}
      onTouchMove={() => {
        navigationTarget.current = undefined;
      }}
      onPointerDown={(e) => {
        if (e.target === root.current) navigationTarget.current = undefined;
      }}
      onKeyDown={(e) => {
        if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(e.key))
          navigationTarget.current = undefined;
      }}
      className="diff-scroll continuous-scroll"
      role="region"
      aria-label="Continuous file diffs"
      tabIndex={0}
      data-preparation-ms={props.preparationMs}
      data-total-items={items.length}
      data-rendered-items={visible.length}
    >
      {error ? (
        <div className="empty-state" role="alert">
          {error}
        </div>
      ) : !files.length ? (
        <div className="empty-state">
          <Check />
          <h2>No local changes</h2>
          <p>Your working tree matches HEAD.</p>
        </div>
      ) : !meta.length ? (
        <div className="loading-state" role="status">
          Preparing diffs…
        </div>
      ) : (
        <div
          className={`diff-canvas ${mode}`}
          style={
            {
              height: virtual.getTotalSize(),
              "--comment-content-width": `${Math.max(150, width - (typeof window !== "undefined" && window.innerWidth < 768 ? 20 : typeof window !== "undefined" && window.innerWidth <= 1200 ? 36 : 56) - 2)}px`,
            } as React.CSSProperties
          }
        >
          {stickyFile && stickyFileIndex !== undefined && (
            <div className="sticky-file-context">
              <FileHeader
                className="sticky-file-header"
                fileIndex={stickyFileIndex}
                file={stickyFile}
                collapsed={collapsed.has(stickyFileIndex)}
                viewed={!!viewed[stickyFileIndex]}
                manual={!!manual[stickyFileIndex]}
                copied={copied === stickyFileIndex}
                onToggleCollapsed={toggleCollapsed}
                onToggleViewed={onToggle}
                onResume={onResume}
                onCopy={copyPath}
              />
            </div>
          )}
          {visible.map((v) => {
            const item = items[v.index],
              file = files[item.file];
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtual.measureElement}
                className={`virtual-diff-item item-${item.kind}`}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`,
                }}
              >
                {item.kind === "header" ? (
                  <div
                    className={`stream-file-header ${collapsed.has(item.file) ? "collapsed" : ""}`}
                  >
                    <FileHeader
                      fileIndex={item.file}
                      file={file}
                      collapsed={collapsed.has(item.file)}
                      viewed={!!viewed[item.file]}
                      manual={!!manual[item.file]}
                      copied={copied === item.file}
                      onToggleCollapsed={toggleCollapsed}
                      onToggleViewed={onToggle}
                      onResume={onResume}
                      onCopy={copyPath}
                    />
                    {mode === "split" && !collapsed.has(item.file) && !file.binary && (
                      <div className="diff-columns">
                        <span>
                          Before <b>HEAD</b>
                        </span>
                        <span>
                          After <b>Working tree</b>
                        </span>
                      </div>
                    )}
                  </div>
                ) : item.kind === "hunk" ? (
                  <div className="hunk-label stream-hunk">
                    <span>
                      {meta[item.file].hunks[item.hunk!].header.split("@@").slice(0, 2).join("@@")}
                      @@
                    </span>
                    <span>{meta[item.file].hunks[item.hunk!].header.split("@@")[2]}</span>
                    {meta[item.file].hunks[item.hunk!].simplified && (
                      <span
                        className="simplified-note"
                        title="Word comparison was bounded to keep this large change responsive."
                      >
                        Line highlights
                      </span>
                    )}
                  </div>
                ) : item.kind === "block" ? (
                  getBlock(item.key) ? (
                    <CodeBlock
                      rows={getBlock(item.key)!}
                      file={item.file}
                      hunk={item.hunk!}
                      reviewFile={files[item.file]}
                      mode={mode}
                      words={words}
                      wrap={wrap}
                      evidence={evidence[file.path]}
                      readContent={readContent}
                    />
                  ) : (
                    <div
                      className="block-placeholder"
                      style={{ height: estimate(v.index) }}
                      aria-label="Loading code lines"
                    >
                      <span>Loading lines…</span>
                    </div>
                  )
                ) : item.kind === "binary" ? (
                  <div className="binary-notice">
                    Binary file changed. Mark it viewed manually after checking the file.
                  </div>
                ) : (
                  <div className="file-end stream-end">
                    {viewed[item.file] ? (
                      <>
                        <Check />
                        Viewed
                      </>
                    ) : (
                      <span>
                        {file.hunks.length} {file.hunks.length === 1 ? "chunk" : "chunks"} · End of
                        file
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
