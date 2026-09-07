import { Folder, GitBranch, GitCompareArrows, MessageSquare, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";

export function WorkspaceTopbar({ repository, branch }: { repository: string; branch: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Superreview home">
        <GitCompareArrows />
        superreview
      </a>
      <div className="top-divider" />
      <div className="repo-label">
        <Folder />
        {repository}
        <span className="branch">
          <GitBranch />
          {branch}
        </span>
      </div>
      <div className="top-actions">
        <button
          className="control"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "mocha" ? "Latte light" : "Mocha dark"} theme`}
        >
          {theme === "mocha" ? <Moon /> : <Sun />}
          <span>{theme === "mocha" ? "Mocha" : "Latte"}</span>
        </button>
      </div>
    </header>
  );
}

export function ReviewHeading({
  title,
  fileCount,
  snapshotLabel,
  branch,
  commentCount,
  commentsActive,
  commentsExpanded,
  onToggleComments,
}: {
  title: string;
  fileCount: number;
  snapshotLabel: string;
  branch: string;
  commentCount: number;
  commentsActive: boolean;
  commentsExpanded: boolean;
  onToggleComments: () => void;
}) {
  return (
    <div className="review-heading">
      <div>
        <div className="review-title">
          <h1>{title}</h1>
          <span className="count">{fileCount}</span>
        </div>
        <div className="review-subtitle">
          {snapshotLabel} <span className="review-subtitle-separator">/</span> {branch}
        </div>
      </div>
      <div className="review-heading-actions">
        <button
          className={`control comments-toggle ${commentsActive ? "active" : ""}`}
          aria-label="Toggle comments overview"
          aria-expanded={commentsExpanded}
          onClick={onToggleComments}
        >
          <MessageSquare />
          Comments
          <span className="count">{commentCount}</span>
        </button>
      </div>
    </div>
  );
}
