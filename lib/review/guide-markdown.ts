import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
const TARGET_PREFIX = "superreview://target/";

type MarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
};

type GuideMarkdown = {
  targetLinks: string[];
  diagrams: string[];
};

/** Inspect Markdown syntax once. Code examples and unused definitions are not links. */
export function inspectGuideMarkdown(markdown: string): GuideMarkdown {
  const tree = parser.parse(markdown);
  const definitions = new Map<string, string>();
  const links: string[] = [];
  const references: string[] = [];
  const diagrams: string[] = [];
  const pending: MarkdownNode[] = [tree];

  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
    if (node.type === "link" && node.url) {
      links.push(node.url);
    }
    if (node.type === "linkReference" && node.identifier) {
      references.push(node.identifier.toLowerCase());
    }
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      diagrams.push(node.value || "");
    }
    for (const child of node.children || []) {
      pending.push(child);
    }
  }

  for (const reference of references) {
    const url = definitions.get(reference);
    if (url) links.push(url);
  }

  const targetLinks = links
    .filter((url) => /^superreview:/i.test(url))
    .map((url) => {
      if (!url.startsWith(TARGET_PREFIX)) return "";
      return url.slice(TARGET_PREFIX.length);
    });
  return { targetLinks, diagrams };
}

/** Only actual Markdown links count. Images, code and unused definitions do not. */
export function guideMarkdownLinks(markdown: string): string[] {
  return inspectGuideMarkdown(markdown).targetLinks;
}
