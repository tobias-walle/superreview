import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export const Markdown = memo(function Markdown({ body }: { body: string }) {
  return (
    <div className="comment-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, ...p }) => (
            <a {...p} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="image-alt">[Image: {alt || "attachment"}]</span>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
