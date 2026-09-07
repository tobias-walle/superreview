import { GitBranch } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";

export function ReviewStatusbar({ branch, fileCount }: { branch: string; fileCount: number }) {
  const { theme } = useTheme();
  return (
    <footer className="statusbar">
      <span>
        <GitBranch />
        {branch}
      </span>
      <span className="desktop-only">{fileCount} changed files</span>
      <div className="status-right">
        <span className="shortcut desktop-only">
          <kbd>J</kbd>
          <kbd>K</kbd> files
        </span>
        <span className="shortcut desktop-only">
          <kbd>V</kbd> view
        </span>
        <span className="desktop-only">UTF-8</span>
        <span>Catppuccin {theme === "mocha" ? "Mocha" : "Latte"}</span>
        <span className="desktop-only">Local snapshot</span>
      </div>
    </footer>
  );
}
