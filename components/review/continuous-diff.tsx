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
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight, Copy, Plus, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LineThreads } from "./comments";
import type { Anchor } from "@/lib/comments/model";
import { Cell, FileIcon } from "./code";
import { useLineVisibility } from "@/hooks/use-line-visibility";
import { useSyntaxHighlighting } from "@/hooks/use-syntax-highlighting";
import {
  BLOCK_ROWS,
  blockIndexForSource,
  hiddenContextBefore,
  renderHunk,
  type BlockMeta,
  type FileMeta,
  type Hunk,
  type ReviewFile,
  type RowPair,
} from "@/lib/diff/render";
import type { Evidence } from "@/lib/review/types";
import { scrollBoundary } from "@/lib/diff/file-order";
import {
  projectScopedRows,
  scopedBlockSources,
  scopeContainsAnchor,
  anchorFileIndex,
  type DiffScope,
  type SourceMask,
  type ScopedRows,
} from "@/lib/diff/scoped-blocks";
export type DiffHandle = {
  scrollToFile: (index: number) => void;
  scrollToAnchor: (anchor: Anchor) => void;
  scrollToStart: () => void;
};
type Item = {
  key: string;
  kind:
    | "header"
    | "hunk"
    | "gap"
    | "block"
    | "context"
    | "end"
    | "binary"
    | "filtered-empty"
    | "scope"
    | "omitted"
    | "explanation";
  mask?: SourceMask;
  file: number;
  hunk?: number;
  block?: number;
  meta?: BlockMeta;
  rows?: RowPair[];
  displayHunk?: Hunk;
  gapCount?: number;
  gapState?: "loading" | "error";
};
const SCOPE_NOTICE_HEIGHT_PX = 64;
const EXPLANATION_ESTIMATED_HEIGHT_PX = 240;
const MOBILE_VIEWPORT_MAX_WIDTH_PX = 767;
const HUNK_HEADER_HEIGHT_PX = 31;
const DESKTOP_FILE_HEADER_GAP_PX = 18;
const MOBILE_FILE_HEADER_GAP_PX = 14;
const DESKTOP_FILE_HEADER_HEIGHT_PX = 46;
const MOBILE_FILE_HEADER_HEIGHT_PX = 44;
type Props = {
  preparationMs: number;
  fileOrder: readonly number[];
  /** Presentation only. Keep files and worker metadata attached to the full snapshot. */
  scope?: DiffScope;
  onOpenFullFile?: (file: number, anchor?: Anchor) => void;
  explanation?: ReactNode;
  files: ReviewFile[];
  evidence: Record<string, Evidence>;
  readContent: (object: string) => Promise<string>;
  meta: FileMeta[];
  error: string;
  mode: string;
  hideDeletions: boolean;
  onShowDeletions: () => void;
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
  markTraversed: (file: number) => void;
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
  displayHunk,
  newSideOnly = false,
  interactive = true,
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
  displayHunk?: Hunk;
  newSideOnly?: boolean;
  interactive?: boolean;
}) {
  const sourceObjects = reviewFile.sourceObjects || {
    old: evidence.before.object,
    new: evidence.after.object,
  };
  const highlight = useSyntaxHighlighting(
    reviewFile.path,
    displayHunk || reviewFile.hunks[hunk],
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
              data-review-line={
                interactive
                  ? `${file}/${hunk}/${[...new Set(r.filter(Boolean).map((l) => l!.sourceIndex))].join(",")}`
                  : undefined
              }
            >
              <Cell
                line={r[0]}
                words={words}
                unified={mode === "unified"}
                newSideOnly={newSideOnly}
                file={file}
                hunk={hunk}
                side="old"
                highlight={highlight}
                interactive={interactive}
              />
              {mode === "split" && (
                <Cell
                  line={r[1]}
                  words={words}
                  file={file}
                  hunk={hunk}
                  side="new"
                  highlight={highlight}
                  interactive={interactive}
                />
              )}
            </div>
            {interactive && (
              <LineThreads
                file={file}
                hunk={hunk}
                sources={[...new Set(r.filter(Boolean).map((l) => l!.sourceIndex))]}
              />
            )}
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
    fileOrder,
    scope,
    onOpenFullFile,
    explanation,
    meta,
    mode,
    hideDeletions,
    onShowDeletions,
    wrap,
    words,
    viewed,
    manual,
    onToggle,
    onResume,
    onActive,
    markSeen,
    markTraversed,
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
  const [expandedGaps, setExpandedGaps] = useState(new Set<string>());
  const [sourceContents, setSourceContents] = useState(new Map<string, string | Error>());
  const anchor = useRef<Item | undefined>(undefined);
  const previousLayout = useRef("");
  // Keep the selected short file active until the human scrolls. This is not a
  // pending scroll request and must not replay when explanation props change.
  const navigationTarget = useRef<number | undefined>(undefined);
  const pendingFileTarget = useRef<number | undefined>(undefined);
  const navigationStartsAtFile = useRef(false);
  const activeTraversal = useRef<{ file: number; fromStart: boolean; scroll: number } | undefined>(
    undefined,
  );
  const traversedFiles = useRef(new Set<number>());
  const toggleCollapsed = useCallback((file: number) => {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);
  const expandFile = useCallback((file: number) => {
    setCollapsed((current) => {
      if (!current.has(file)) return current;
      const next = new Set(current);
      next.delete(file);
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
  const toggleGap = useCallback(
    (file: number, hunk: number) => {
      const key = `${file}:${hunk}`;
      const reviewFile = files[file];
      const fallback = evidence[reviewFile.path];
      const object =
        reviewFile.sourceObjects?.new ||
        reviewFile.sourceObjects?.old ||
        fallback.after.object ||
        fallback.before.object;
      const cached = object ? sourceContents.get(object) : undefined;
      setExpandedGaps((current) => {
        const next = new Set(current);
        if (next.has(key) && !(cached instanceof Error)) next.delete(key);
        else next.add(key);
        return next;
      });
      if (!object || typeof cached === "string") return;
      void readContent(object)
        .then((content) => {
          setSourceContents((current) => new Map(current).set(object, content));
        })
        .catch((error) => {
          setSourceContents((current) => new Map(current).set(object, error));
        });
    },
    [evidence, files, readContent, sourceContents],
  );
  useEffect(() => {
    setExpandedGaps(new Set());
    setPendingComment(null);
    navigationTarget.current = undefined;
    pendingFileTarget.current = undefined;
  }, [files]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const blockMode = hideDeletions ? "new" : mode === "split" ? "split" : "unified";
  const { items, starts } = useMemo(() => {
    const items: Item[] = [],
      starts: number[] = [];
    if (explanation && fileOrder.length)
      items.push({ key: "scope:explanation", kind: "explanation", file: fileOrder[0] });
    fileOrder.forEach((fi) => {
      const file = meta[fi];
      if (!file || (scope && !scope.has(fi))) return;
      starts[fi] = items.length;
      items.push({ key: `${fi}:header`, kind: "header", file: fi });
      if (collapsed.has(fi)) return;
      const scoped = scope?.get(fi);
      if (scoped?.partial) {
        items.push({ key: `${fi}:scope`, kind: "scope", file: fi });
        const onlyHiddenDeletions =
          hideDeletions &&
          file.hunks.every((hunk, hi) =>
            hunk.new.every((block) => !scopedBlockSources(block, scoped.hunks[hi]).length),
          );
        if (onlyHiddenDeletions) {
          items.push({ key: `${fi}:filtered-empty`, kind: "filtered-empty", file: fi });
          items.push({ key: `${fi}:end`, kind: "end", file: fi });
          return;
        }
        const omit = (key: string) => {
          if (items.at(-1)?.kind !== "omitted") items.push({ key, kind: "omitted", file: fi });
        };
        file.hunks.forEach((hunk, hi) => {
          const mask = scoped.hunks[hi];
          if (!mask) return;
          if (hiddenContextBefore(files[fi].hunks, hi)) omit(`${fi}:${hi}:scope-gap`);
          let heading = false;
          hunk[blockMode].forEach((block, bi) => {
            const sources = scopedBlockSources(block, mask);
            if (!sources.length) {
              omit(`${fi}:${hi}:${blockMode}:${bi}:omitted`);
              return;
            }
            if (!heading) {
              items.push({ key: `${fi}:${hi}:hunk`, kind: "hunk", file: fi, hunk: hi });
              heading = true;
            }
            items.push({
              // This is still the ORIGINAL worker request/cache key.
              key: `${fi}:${hi}:${blockMode}:${bi}`,
              kind: "block",
              file: fi,
              hunk: hi,
              block: bi,
              meta: { ...block, sources },
              mask,
            });
          });
        });
        // Never expose the lazy full-source expander in a partial view.
        omit(`${fi}:scope-tail`);
        items.push({ key: `${fi}:end`, kind: "end", file: fi });
        return;
      }
      if (hideDeletions && !files[fi].binary && file.hunks.every((hunk) => !hunk.new.length)) {
        items.push({ key: `${fi}:filtered-empty`, kind: "filtered-empty", file: fi });
        items.push({ key: `${fi}:end`, kind: "end", file: fi });
        return;
      }
      if (files[fi].binary) items.push({ key: `${fi}:binary`, kind: "binary", file: fi });
      // Include a final divider so the captured file's tail can be revealed lazily.
      [...file.hunks, undefined].forEach((h, hi) => {
        if (!file.hunks.length) return;
        const hidden = hiddenContextBefore(files[fi].hunks, hi);
        if (hidden) {
          const gapKey = `${fi}:${hi}`;
          const expanded = expandedGaps.has(gapKey);
          const fallback = evidence[files[fi].path];
          const useNew = !!(files[fi].sourceObjects?.new || fallback.after.object);
          const object = useNew
            ? files[fi].sourceObjects?.new || fallback.after.object
            : files[fi].sourceObjects?.old || fallback.before.object;
          const content = object ? sourceContents.get(object) : undefined;
          items.push({
            key: `${gapKey}:hunk`,
            kind: "gap",
            file: fi,
            hunk: hi,
            gapCount: hidden.count,
            gapState: expanded
              ? content instanceof Error
                ? "error"
                : typeof content === "string"
                  ? undefined
                  : "loading"
              : undefined,
          });
          if (expanded && typeof content === "string") {
            const sourceLines = content.split("\n");
            if (sourceLines.at(-1) === "") sourceLines.pop();
            const start = useNew ? hidden.newStart : hidden.oldStart;
            const displayHunk: Hunk = {
              header: "",
              oldStart: hidden.oldStart,
              newStart: hidden.newStart,
              lines: sourceLines
                .slice(start - 1, start - 1 + hidden.count)
                .map((line) => ` ${line}`),
            };
            const rendered = renderHunk(displayHunk);
            const rows =
              mode === "split"
                ? rendered.split
                : rendered.unified.map((line): RowPair => [line, undefined]);
            for (let offset = 0; offset < rows.length; offset += BLOCK_ROWS) {
              const blockRows = rows.slice(offset, offset + BLOCK_ROWS);
              items.push({
                key: `${gapKey}:context:${mode}:${offset / BLOCK_ROWS}`,
                kind: "context",
                file: fi,
                hunk: hi,
                block: offset / BLOCK_ROWS,
                rows: blockRows,
                displayHunk,
                meta: {
                  count: blockRows.length,
                  lengths: blockRows.map(([old, next]) =>
                    Math.max(old?.text.length || 0, next?.text.length || 0),
                  ),
                  sources: [],
                },
              });
            }
          }
        }
        if (!h) return;
        if (!hidden)
          items.push({
            key: `${fi}:${hi}:hunk`,
            kind: "hunk",
            file: fi,
            hunk: hi,
          });
        const blocks = h[blockMode];
        blocks.forEach((block, bi) =>
          items.push({
            key: `${fi}:${hi}:${blockMode}:${bi}`,
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
  }, [
    fileOrder,
    scope,
    explanation,
    meta,
    files,
    mode,
    blockMode,
    hideDeletions,
    collapsed,
    expandedGaps,
    evidence,
    sourceContents,
  ]);
  const estimate = useCallback(
    (i: number) => {
      const item = items[i];
      if (item.kind === "header")
        return (
          64 + (mode === "split" && !collapsed.has(item.file) && !files[item.file].binary ? 29 : 0)
        );
      if (item.kind === "hunk" || item.kind === "gap" || item.kind === "omitted")
        return HUNK_HEADER_HEIGHT_PX;
      if (item.kind === "scope") return SCOPE_NOTICE_HEIGHT_PX;
      if (item.kind === "explanation") return EXPLANATION_ESTIMATED_HEIGHT_PX;
      if (item.kind === "end") return 32;
      if (item.kind === "binary" || item.kind === "filtered-empty") return 96;
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
  const mobileViewport =
    typeof window !== "undefined" && window.innerWidth <= MOBILE_VIEWPORT_MAX_WIDTH_PX;
  const headerGap = mobileViewport ? MOBILE_FILE_HEADER_GAP_PX : DESKTOP_FILE_HEADER_GAP_PX;
  const headerHeight = mobileViewport
    ? MOBILE_FILE_HEADER_HEIGHT_PX
    : DESKTOP_FILE_HEADER_HEIGHT_PX;
  let stickyFileIndex: number | undefined;
  if (topVirtualItem) {
    const topItem = items[topVirtualItem.index];
    if (topItem.kind === "explanation") {
      stickyFileIndex = undefined;
    } else if (topItem.kind !== "header" || scrollTop >= topVirtualItem.start + headerGap) {
      stickyFileIndex = topItem.file;
    } else if (topVirtualItem.index > 0 && items[topVirtualItem.index - 1].kind !== "explanation") {
      stickyFileIndex = items[topVirtualItem.index - 1].file;
    }
  }
  const stickyFile = stickyFileIndex === undefined ? undefined : files[stickyFileIndex];
  const incomingHeader = visible.find(
    (item) =>
      items[item.index]?.kind === "header" &&
      items[item.index].file !== stickyFileIndex &&
      item.start + headerGap > scrollTop,
  );
  const stickyHeaderOffset = incomingHeader
    ? Math.min(0, incomingHeader.start + headerGap - scrollTop - headerHeight)
    : 0;
  const layout = `${mode}:${hideDeletions}:${wrap}:${Math.round(width)}`;
  const collapsedKey = [...collapsed].sort((a, b) => a - b).join(",");
  useEffect(() => {
    activeTraversal.current = undefined;
    traversedFiles.current.clear();
  }, [layout, collapsedKey, files, scope]);
  const keys = visible
    .filter((v) => items[v.index]?.kind === "block")
    .map((v) => items[v.index].key)
    .join("|");
  useEffect(() => {
    if (keys) request(keys.split("|"));
  }, [keys, request, version]);
  useEffect(() => {
    // The offset can change while the virtual item range stays identical.
    const scroll = scrollTop;
    const viewportHeight = root.current?.clientHeight || 0;
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
      // At a scroll boundary, a short final/first file may occupy less area than its neighbor.
      // Keep the counter and navigation aligned with the actual end, not the largest visible file.
      const boundary = scrollBoundary(scroll, viewportHeight, root.current?.scrollHeight || 0);
      if (boundary === "start") active = items[0].file;
      if (boundary === "end") active = items[items.length - 1].file;
      if (navigationTarget.current !== undefined && (areas.get(navigationTarget.current) || 0) > 0)
        active = navigationTarget.current;
      // A partial presentation cannot prove traversal of the original file.
      if (!hideDeletions && !scope) {
        const previous = activeTraversal.current;
        if (!previous) {
          activeTraversal.current = { file: active, fromStart: boundary === "start", scroll };
        } else if (previous.file === active) {
          previous.scroll = scroll;
        } else {
          const movingDown = scroll > previous.scroll;
          const previousPosition = fileOrder.indexOf(previous.file);
          const activePosition = fileOrder.indexOf(active);
          const navigated = navigationTarget.current === active;
          if (
            movingDown &&
            previous.fromStart &&
            !collapsed.has(previous.file) &&
            !navigated &&
            !traversedFiles.current.has(previous.file)
          ) {
            traversedFiles.current.add(previous.file);
            markTraversed(previous.file);
          }
          activeTraversal.current = {
            file: active,
            fromStart:
              boundary === "start" ||
              (navigated && navigationStartsAtFile.current) ||
              (movingDown && activePosition === previousPosition + 1),
            scroll,
          };
        }
        const traversal = activeTraversal.current;
        if (
          boundary === "end" &&
          traversal?.fromStart &&
          !collapsed.has(traversal.file) &&
          !traversedFiles.current.has(traversal.file)
        ) {
          traversedFiles.current.add(traversal.file);
          markTraversed(traversal.file);
        }
      }
      onActive(active);
    }
  }, [
    visible,
    items,
    onActive,
    scrollTop,
    hideDeletions,
    fileOrder,
    markTraversed,
    collapsed,
    scope,
  ]);
  useLayoutEffect(() => {
    if (previousLayout.current && previousLayout.current !== layout) {
      const old = anchor.current;
      virtual.measure();
      // Refresh estimated offsets before resizeItem compares against them.
      virtual.getTotalSize();
      // Clearing the size cache does not resize mounted DOM nodes. Remeasure
      // them now so wrapped scope notices cannot overlap the following item.
      for (const element of root.current?.querySelectorAll<HTMLElement>(".virtual-diff-item") ||
        []) {
        // measureElement may defer while scrolling, including our restoration.
        virtual.resizeItem(Number(element.dataset.index), element.offsetHeight);
      }
      const candidates = old
        ? items.filter(
            (item) => item.file === old.file && item.kind === old.kind && item.hunk === old.hunk,
          )
        : [];
      const candidateIndex =
        old?.kind === "block"
          ? blockIndexForSource(
              candidates.map((item) => item.meta!),
              old.meta!.sources[0],
            )
          : candidates.findIndex((item) => item.block === old?.block);
      const target = candidates[candidateIndex];
      const restored = target ? items.indexOf(target) : old ? starts[old.file] : undefined;
      if (restored !== undefined) virtual.scrollToIndex(restored, { align: "start" });
    }
    previousLayout.current = layout;
  }, [layout, virtual, items, starts]);
  useImperativeHandle(
    ref,
    () => ({
      scrollToStart() {
        navigationTarget.current = undefined;
        pendingFileTarget.current = undefined;
        setPendingComment(null);
        if (root.current) root.current.scrollTop = 0;
      },
      scrollToAnchor(a) {
        pendingFileTarget.current = undefined;
        const file = anchorFileIndex(files, a);
        if (file < 0) return;
        if (!scopeContainsAnchor(scope, file, files[file], a)) {
          if (onOpenFullFile) {
            // Wait for the caller to switch scope before requesting or scrolling
            // original blocks. The callback may update the workspace asynchronously.
            setPendingComment(a);
            onOpenFullFile(file, a);
          }
          return;
        }
        if (a.side === "old" && hideDeletions && a.kind !== "file") onShowDeletions();
        navigationTarget.current = file;
        navigationStartsAtFile.current = a.kind === "file";
        expandFile(file);
        if (a.kind === "file") {
          virtual.scrollToIndex(starts[file], { align: "start" });
          return;
        }
        setPendingComment(a);
      },
      scrollToFile(index) {
        if (!fileOrder.includes(index)) return;
        navigationTarget.current = index;
        navigationStartsAtFile.current = true;
        setPendingComment(null);
        if (starts[index] === undefined) {
          pendingFileTarget.current = index;
          return;
        }
        pendingFileTarget.current = undefined;
        expandFile(index);
        virtual.scrollToIndex(starts[index], { align: "start" });
      },
    }),
    [
      starts,
      virtual,
      files,
      fileOrder,
      scope,
      expandFile,
      onOpenFullFile,
      hideDeletions,
      onShowDeletions,
    ],
  );
  useEffect(() => {
    const target = pendingFileTarget.current;
    if (target === undefined) return;
    if (!fileOrder.includes(target)) {
      pendingFileTarget.current = undefined;
      return;
    }
    if (starts[target] === undefined) return;
    pendingFileTarget.current = undefined;
    expandFile(target);
    virtual.scrollToIndex(starts[target], { align: "start" });
  }, [starts, virtual, fileOrder, expandFile]);
  useEffect(() => {
    if (!pendingComment) return;
    const a = pendingComment;
    const fi = anchorFileIndex(files, a);
    if (fi < 0 || meta[fi]?.fingerprint !== a.fingerprint) return;
    if (!scopeContainsAnchor(scope, fi, files[fi], a)) return;
    navigationTarget.current = fi;
    expandFile(fi);
    if (a.kind === "file") {
      if (starts[fi] === undefined) return;
      virtual.scrollToIndex(starts[fi], { align: "start" });
      setPendingComment(null);
      return;
    }
    if (a.side === "old" && hideDeletions) {
      onShowDeletions();
      return;
    }
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
  }, [
    pendingComment,
    expandFile,
    items,
    meta,
    files,
    scope,
    starts,
    hideDeletions,
    onShowDeletions,
    version,
    virtual,
    request,
    keys,
  ]);
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
            <div
              className="sticky-file-context"
              style={{ transform: `translateY(${stickyHeaderOffset}px)` }}
            >
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
            let filteredNotice = "No resulting lines in this diff";
            if (file.status === "D") filteredNotice = "Deleted file · No new content";
            else if (scope?.get(item.file)?.partial)
              filteredNotice = "No resulting lines in this chunk";
            let blockParts: ScopedRows[] | undefined;
            if (item.kind === "block") {
              const rows = getBlock(item.key);
              if (rows) {
                if (item.mask) blockParts = projectScopedRows(rows, item.mask, mode);
                else blockParts = [{ kind: "rows", rows }];
              }
            }
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
                {item.kind === "explanation" ? (
                  <div className="guide-reading-surface">{explanation}</div>
                ) : item.kind === "scope" ? (
                  <div className="filtered-file-notice">
                    <span>Partial file · Only this chunk’s ranges and nearby unchanged rows</span>
                    <button
                      className="control"
                      disabled={!onOpenFullFile}
                      onClick={() => onOpenFullFile?.(item.file)}
                    >
                      Open full file
                    </button>
                  </div>
                ) : item.kind === "omitted" ? (
                  <div className="hunk-label stream-hunk">
                    Changes or context omitted from this chunk
                  </div>
                ) : item.kind === "header" ? (
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
                ) : item.kind === "gap" ? (
                  <button
                    className="hunk-label hunk-gap stream-hunk"
                    type="button"
                    title={
                      expandedGaps.has(`${item.file}:${item.hunk}`)
                        ? "Hide unchanged context"
                        : "Show unchanged context"
                    }
                    aria-label={`${expandedGaps.has(`${item.file}:${item.hunk}`) ? "Hide" : "Show"} ${Number.isFinite(item.gapCount) ? `${item.gapCount} hidden lines` : "end of file"}`}
                    aria-expanded={expandedGaps.has(`${item.file}:${item.hunk}`)}
                    onClick={() => toggleGap(item.file, item.hunk!)}
                  >
                    <span>
                      {meta[item.file].hunks[item.hunk!]?.header
                        .split("@@")
                        .slice(0, 2)
                        .join("@@") || "@@"}
                      {meta[item.file].hunks[item.hunk!] ? "@@" : " End of file"}
                    </span>
                    <span className="hunk-context-heading">
                      {meta[item.file].hunks[item.hunk!]?.header.split("@@")[2]}
                    </span>
                    <span className="hunk-context-action">
                      {item.gapState === "loading"
                        ? "Loading…"
                        : item.gapState === "error"
                          ? "Retry"
                          : expandedGaps.has(`${item.file}:${item.hunk}`)
                            ? "Hide context"
                            : ""}
                      <Plus />
                    </span>
                  </button>
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
                ) : item.kind === "context" ? (
                  <CodeBlock
                    rows={item.rows!}
                    file={item.file}
                    hunk={item.hunk!}
                    reviewFile={files[item.file]}
                    mode={mode}
                    words={words}
                    wrap={wrap}
                    evidence={evidence[file.path]}
                    readContent={readContent}
                    displayHunk={item.displayHunk}
                    newSideOnly={hideDeletions}
                    interactive={false}
                  />
                ) : item.kind === "block" ? (
                  blockParts ? (
                    blockParts.map((part, index) =>
                      part.kind === "omitted" ? (
                        <div key={index} className="hunk-label stream-hunk">
                          {part.changes
                            ? "Changes omitted from this chunk"
                            : "Context omitted from this chunk"}
                        </div>
                      ) : (
                        <CodeBlock
                          key={index}
                          rows={part.rows}
                          file={item.file}
                          hunk={item.hunk!}
                          reviewFile={files[item.file]}
                          mode={mode}
                          newSideOnly={hideDeletions}
                          words={words}
                          wrap={wrap}
                          evidence={evidence[file.path]}
                          readContent={readContent}
                        />
                      ),
                    )
                  ) : (
                    <div
                      className="block-placeholder"
                      style={{ height: estimate(v.index) }}
                      aria-label="Loading code lines"
                    >
                      <span>Loading lines…</span>
                    </div>
                  )
                ) : item.kind === "filtered-empty" ? (
                  <div className="filtered-file-notice">
                    <span>{filteredNotice}</span>
                    <button className="control" onClick={onShowDeletions}>
                      Show deletions
                    </button>
                  </div>
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
