export type FileTreeEntry =
  | { kind: "folder"; key: string; label: string; path: string; depth: number; count: number }
  | { kind: "file"; key: string; file: number; depth: number };

type FolderNode = {
  kind: "folder";
  name: string;
  path: string;
  count: number;
  children: Array<FolderNode | FileNode>;
  folders: Map<string, FolderNode>;
};
type FileNode = { kind: "file"; path: string; file: number };

export function buildFileTreeEntries(
  paths: string[],
  closed: ReadonlySet<string>,
): FileTreeEntry[] {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: "",
    count: 0,
    children: [],
    folders: new Map(),
  };
  paths.forEach((path, file) => {
    const parts = path.split("/");
    let parent = root;
    parent.count++;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const name = parts[depth];
      const folderPath = parts.slice(0, depth + 1).join("/");
      let folder = parent.folders.get(name);
      if (!folder) {
        folder = {
          kind: "folder",
          name,
          path: folderPath,
          count: 0,
          children: [],
          folders: new Map(),
        };
        parent.folders.set(name, folder);
        parent.children.push(folder);
      }
      folder.count++;
      parent = folder;
    }
    parent.children.push({ kind: "file", path, file });
  });
  const entries: FileTreeEntry[] = [];
  const appendChildren = (children: Array<FolderNode | FileNode>, depth: number) => {
    for (const child of children) {
      if (child.kind === "file") {
        entries.push({ kind: "file", key: child.path, file: child.file, depth });
        continue;
      }
      const labels = [child.name];
      let folder = child;
      while (folder.children.length === 1 && folder.children[0].kind === "folder") {
        folder = folder.children[0];
        labels.push(folder.name);
      }
      entries.push({
        kind: "folder",
        key: `folder:${folder.path}`,
        label: labels.join("/"),
        path: folder.path,
        depth,
        count: folder.count,
      });
      if (!closed.has(folder.path)) appendChildren(folder.children, depth + 1);
    }
  };
  appendChildren(root.children, 0);
  return entries;
}

// Display order only. Keep snapshot indices intact for worker keys, anchors and coverage.
// Closed tree folders must not hide files from the diff or sequential navigation.
export function fileDisplayOrder(paths: string[]): number[] {
  return buildFileTreeEntries(paths, new Set()).flatMap((entry) =>
    entry.kind === "file" ? [entry.file] : [],
  );
}

export function fileNavigation(order: readonly number[], selected: number) {
  const index = order.indexOf(selected);
  return {
    position: index < 0 ? 0 : index + 1,
    count: order.length,
    previous: index > 0 ? order[index - 1] : undefined,
    next: index >= 0 ? order[index + 1] : undefined,
  };
}
export type FileNavigation = ReturnType<typeof fileNavigation>;

// Browser scroll offsets can be fractional, while client/scroll heights are rounded.
const SCROLL_EDGE_TOLERANCE_PX = 1;
export function scrollBoundary(
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
): "start" | "end" | undefined {
  if (scrollTop <= SCROLL_EDGE_TOLERANCE_PX) return "start";
  if (
    scrollHeight > viewportHeight &&
    scrollTop + viewportHeight >= scrollHeight - SCROLL_EDGE_TOLERANCE_PX
  )
    return "end";
}
