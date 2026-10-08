import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GuideDiagram } from "./guide-diagram";

const TARGET_PREFIX = "superreview://target/";
// Match schema-1 identifiers. Existence is checked when publishing/loading the
// guide, and onTarget resolves the ID against that same immutable revision.
const TARGET_ID_CHARACTERS = 100;

export function guideTargetId(url: string): string | null {
  if (!url.startsWith(TARGET_PREFIX)) return null;
  const id = url.slice(TARGET_PREFIX.length);
  if (!id || id.length > TARGET_ID_CHARACTERS || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return null;
  }
  return id;
}

export function guideMarkdownUrl(url: string): string {
  if (guideTargetId(url)) return url;
  if (/^(?:https?:\/\/|mailto:)/i.test(url)) return url;
  return "";
}

export function GuideMarkdown({
  markdown,
  onTarget,
}: {
  markdown: string;
  onTarget: (id: string) => void;
}) {
  return (
    <div className="comment-markdown min-w-0 max-w-full [&_pre]:max-w-full [&_table]:max-w-full">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={guideMarkdownUrl}
        components={{
          a: ({ children, href }) => {
            const id = guideTargetId(href || "");
            if (id) {
              return (
                <button
                  type="button"
                  className="min-h-8 cursor-pointer rounded-sm text-left text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={() => onTarget(id)}
                >
                  {children}
                </button>
              );
            }
            if (!href) return <span>{children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span className="image-alt">[Image: {alt || "attachment"}]</span>,
          pre: ({ children }) => {
            if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
              const language = children.props.className;
              if (language?.toLowerCase() === "language-mermaid") {
                const source = String(children.props.children || "").replace(/\n$/, "");
                return <GuideDiagram source={source} />;
              }
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
