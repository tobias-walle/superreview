import { useEffect } from "react";

export function useWorkspaceShortcuts({
  selected,
  fileCount,
  onSelectFile,
  onToggleMode,
  onToggleTheme,
}: {
  selected: number;
  fileCount: number;
  onSelectFile: (file: number) => void;
  onToggleMode: () => void;
  onToggleTheme: () => void;
}) {
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)
      )
        return;
      if (event.key === "j" || (event.key === "ArrowDown" && event.shiftKey)) {
        event.preventDefault();
        onSelectFile(Math.min(selected + 1, fileCount - 1));
      }
      if (event.key === "k" || (event.key === "ArrowUp" && event.shiftKey)) {
        event.preventDefault();
        onSelectFile(Math.max(selected - 1, 0));
      }
      if (event.key === "v") onToggleMode();
      if (event.key === "t") onToggleTheme();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [selected, fileCount, onSelectFile, onToggleMode, onToggleTheme]);
}
