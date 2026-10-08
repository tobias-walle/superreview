import { useId } from "react";
import { GuideMarkdown } from "./guide-markdown";

export type GuideExplanationProps = {
  title: string;
  markdown: string;
  onTarget: (id: string) => void;
  scopeLabel: string;
  authorName?: string;
};

export function GuideExplanation({
  title,
  markdown,
  onTarget,
  scopeLabel,
  authorName,
}: GuideExplanationProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 max-w-full border-b border-border bg-background p-4 text-foreground"
    >
      <header className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 break-words">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Captured scope: {scopeLabel}</p>
        </div>
        <p className="flex min-w-0 max-w-full flex-wrap items-center gap-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          <span className="rounded-sm border border-border px-1 py-0.5 font-medium text-foreground">
            Agent
          </span>
          {authorName || "Guide author"}
        </p>
      </header>
      <GuideMarkdown markdown={markdown} onTarget={onTarget} />
    </section>
  );
}
