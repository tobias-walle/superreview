import { useEffect } from "react";
import type { FileNavigation } from "@/lib/diff/file-order";

export function useWorkspaceShortcuts({
  navigation,
  onSelectFile,
  onToggleMode,
  onToggleTheme,
}: {
  navigation: FileNavigation;
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
        if (navigation.next !== undefined) onSelectFile(navigation.next);
      }
      if (event.key === "k" || (event.key === "ArrowUp" && event.shiftKey)) {
        event.preventDefault();
        if (navigation.previous !== undefined) onSelectFile(navigation.previous);
      }
      if (event.key === "v") onToggleMode();
      if (event.key === "t") onToggleTheme();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigation, onSelectFile, onToggleMode, onToggleTheme]);
}
