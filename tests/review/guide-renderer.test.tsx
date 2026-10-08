import test from "node:test";
import assert from "node:assert/strict";
import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GuideExplanation,
  type GuideExplanationProps,
} from "../../components/review/guide-explanation";
import {
  GuideMarkdown,
  guideMarkdownUrl,
  guideTargetId,
} from "../../components/review/guide-markdown";
import { GuideDiagram } from "../../components/review/guide-diagram";
import {
  checkGuideDiagram,
  GUIDE_DIAGRAM_LIMITS,
  safeGuideSvgAttribute,
  safeGuideSvgViewBox,
} from "../../lib/review/guide-diagram-policy";

const document = `## Summary

The contract and handler belong together. [Handler][handler].

\`\`\`mermaid
flowchart LR
  contract[Contract] --> handler[Handler]
\`\`\`

## Walkthrough

Inspect [the handler][handler].

## Review questions

Does the handler preserve the contract?

[handler]: superreview://target/handler
`;

function explanationProps(overrides: Partial<GuideExplanationProps> = {}): GuideExplanationProps {
  return {
    title: "API contract",
    markdown: document,
    onTarget: () => assert.fail("Rendering must not navigate"),
    scopeLabel: "Staged changes: src/api",
    authorName: "Coding assistant",
    ...overrides,
  };
}

test("explanation renders the complete document as one reading surface", () => {
  const html = renderToStaticMarkup(<GuideExplanation {...explanationProps()} />);
  assert.match(html, /Agent/);
  assert.match(html, /Coding assistant/);
  assert.match(html, /Captured scope: Staged changes: src\/api/);
  assert.match(html, /The contract and handler belong together/);
  assert.match(html, /Walkthrough/);
  assert.match(html, /Inspect/);
  assert.match(html, /Review questions/);
  assert.match(html, /Does the handler preserve the contract/);
  assert.match(html, /Rendering diagram/);
  assert.doesNotMatch(html, /<details|Chunk read|<svg/);
});

test("reference links resolve across the complete explanation", () => {
  const markdown =
    'Summary: [target][t].\n\n## Walkthrough\n\nInspect [target][t].\n\n> [t]: superreview://target/handler\n>   "Captured handler"';
  const html = renderToStaticMarkup(<GuideExplanation {...explanationProps({ markdown })} />);
  assert.equal((html.match(/<button[^>]*>target<\/button>/g) || []).length, 2);
});

test("guide Markdown skips raw HTML and images and isolates Mermaid from ordinary code", () => {
  const markdown = `Inspect [\`importGuide()\`](superreview://target/import-guide).

Text <img src="https://evil.test/pixel">.

![A diagram](https://evil.test/diagram.svg)

[Unsafe](javascript:alert%281%29)

[External](https://example.test/docs)

\`\`\`typescript
const sample = "flowchart LR";
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;
  const html = renderToStaticMarkup(<GuideMarkdown markdown={markdown} onTarget={() => {}} />);
  assert.doesNotMatch(html, /<img|src=|href="javascript|<script|<iframe/);
  assert.match(html, /<button[^>]*><code>importGuide\(\)<\/code><\/button>/);
  assert.match(html, /\[Image: A diagram\]/);
  assert.match(
    html,
    /href="https:\/\/example.test\/docs" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(html, /<pre><code class="language-typescript"/);
  assert.equal((html.match(/<figure/g) || []).length, 1);
  assert.doesNotMatch(html, /<pre><figure/);
});

test("only canonical target identifiers become navigation actions", () => {
  for (const url of [
    "superreview://target/",
    "superreview://target/../secret",
    "superreview://target/a/b",
    "superreview://target/a?query",
    "superreview://target/a#hash",
    "superreview://target/%61",
    "SUPERREVIEW://target/a",
    "superreview://target/" + "a".repeat(101),
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.test",
    "/api/delete",
  ]) {
    assert.equal(guideTargetId(url), null, url);
    assert.equal(guideMarkdownUrl(url), "", url);
  }
  assert.equal(guideTargetId("superreview://target/handler_2-new"), "handler_2-new");
  assert.equal(guideMarkdownUrl("https://example.test"), "https://example.test");
  assert.equal(guideMarkdownUrl("mailto:review@example.test"), "mailto:review@example.test");
});

test("target button invokes the callback without supplying an executable URL", () => {
  const targets: string[] = [];
  // The wrapper has no hooks. Exercise its custom link primitive directly, so
  // this contract test needs neither a browser nor a separate test renderer.
  const wrapper = GuideMarkdown({ markdown: "", onTarget: (id) => targets.push(id) });
  const renderer = wrapper.props.children;
  const link = renderer.props.components.a({
    href: "superreview://target/handler",
    children: "Handler",
  }) as ReactElement<{ onClick: () => void; href?: string; type: string }>;
  assert.equal(link.type, "button");
  assert.equal(link.props.type, "button");
  assert.equal(link.props.href, undefined);
  assert.deepEqual(targets, []);
  link.props.onClick();
  assert.deepEqual(targets, ["handler"]);
  const unsafe = renderer.props.components.a({ href: "", children: "Unsafe" });
  assert.equal(unsafe.type, "span");
});

test("unsafe diagrams have visible SSR warnings without hiding the rest of the Markdown", () => {
  const html = renderToStaticMarkup(
    <GuideMarkdown
      markdown={"Before.\n\n```mermaid\nflowchart LR\nclick A callback\n```\n\nAfter."}
      onTarget={() => {}}
    />,
  );
  assert.match(html, /Diagram unavailable/);
  assert.match(html, /actions, styles and links/);
  assert.match(html, /Before/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /Rendering diagram|<svg/);
});

test("diagram accessibility uses authored descriptions when supplied", () => {
  const html = renderToStaticMarkup(
    <GuideDiagram
      source={
        "sequenceDiagram\naccTitle: Order request\naccDescr: The route calls the service before replying.\nRoute->>Service: place order"
      }
    />,
  );
  assert.match(html, /<figcaption[^>]*>The route calls the service before replying/);
  const block = renderToStaticMarkup(
    <GuideDiagram
      source={
        "flowchart LR\naccDescr {\n  The contract generates bindings.\n}\nContract-->Bindings"
      }
    />,
  );
  assert.match(block, /<figcaption[^>]*>The contract generates bindings/);
});

test("diagram policy accepts explanatory action words in ordinary labels and messages", () => {
  const sources = [
    "flowchart LR\nA[call the service] --> B[link the class]",
    "flowchart LR\nA[call; link the class] --> B[configuration]",
    'flowchart LR\nA["call; link class; style the response"] --> B[done]',
    'flowchart LR\nA["Use class:::name syntax in prose"] --> B[done]',
    'flowchart LR\nA{"call or link the class?"} --> B(done)',
    "sequenceDiagram\nClient->>Service: call the class; link the response\nService-->>Client: response",
  ];
  for (const source of sources) assert.deepEqual(checkGuideDiagram(source), { valid: true });
});

test("diagram policy rejects configuration, actions, HTML and resources", () => {
  const sources = [
    '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\nA-->B',
    "---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B",
    "flowchart LR\nA-->B\nclick A callback",
    "flowchart LR\nA-->B; click A call handler()",
    'sequenceDiagram\nlinks Alice: {"Docs": "https://example.test"}',
    'flowchart LR\nA["<img src=x onerror=alert(1)>"] --> B',
    'flowchart LR\nA["&lt;script&gt;"] --> B',
    'flowchart LR\nA@{ img: "x", label: "image" }',
    'flowchart LR\nA["`rich label`"] --> B',
    "flowchart LR\nstyle A fill:red",
    "flowchart LR\nclassDef danger fill:red",
    "flowchart LR\nclass A danger",
    "flowchart LR\nA:::danger --> B",
    'flowchart LR\nA["data:image/svg+xml,test"] --> B',
    'flowchart LR\nA["url(example)"] --> B',
    'pie\n"Items": 2',
    "flowchart LR\nA\u0000-->B",
  ];
  for (const source of sources) assert.equal(checkGuideDiagram(source).valid, false, source);
});

test("diagram source size, edges and nesting are bounded before rendering", () => {
  const oversized = "flowchart LR\n" + "a".repeat(GUIDE_DIAGRAM_LIMITS.sourceCharacters);
  const wideLine = "flowchart LR\n" + "a".repeat(GUIDE_DIAGRAM_LIMITS.lineCharacters + 1);
  const manyLines = "flowchart LR\n" + "%% comment\n".repeat(GUIDE_DIAGRAM_LIMITS.lines);
  const manyEdges = "flowchart LR\n" + "A --> B\n".repeat(GUIDE_DIAGRAM_LIMITS.edges + 1);
  const deep = "flowchart LR\n" + "subgraph group\n".repeat(GUIDE_DIAGRAM_LIMITS.nesting + 1);
  const inlineDeep = "flowchart LR\n" + "subgraph group;".repeat(GUIDE_DIAGRAM_LIMITS.nesting + 1);
  for (const source of [oversized, wideLine, manyLines, manyEdges, deep, inlineDeep]) {
    assert.equal(checkGuideDiagram(source).valid, false);
  }
});

test("SVG paint/resources and dimensions are constrained independently of Mermaid", () => {
  assert.equal(safeGuideSvgAttribute("fill", "url(https://evil.test/pixel.svg)"), false);
  assert.equal(safeGuideSvgAttribute("stroke", "url(data:image/svg+xml,test)"), false);
  assert.equal(safeGuideSvgAttribute("marker-end", "url(https://evil.test/arrow.svg#id)"), false);
  assert.equal(safeGuideSvgAttribute("marker-end", "url(#guide-arrow)"), true);
  assert.equal(safeGuideSvgAttribute("fill", "#fff"), true);
  for (const name of ["href", "xlink:href", "src", "style", "filter", "onload"]) {
    assert.equal(safeGuideSvgAttribute(name, "anything"), false);
  }
  assert.equal(safeGuideSvgAttribute("height", "Infinity"), false);
  assert.equal(
    safeGuideSvgAttribute("width", String(GUIDE_DIAGRAM_LIMITS.svgDimension + 1)),
    false,
  );
  assert.equal(safeGuideSvgAttribute("width", "101%"), false);
  assert.equal(safeGuideSvgAttribute("width", "100%"), true);
  assert.equal(safeGuideSvgViewBox("0 0 100 50"), true);
  for (const value of ["", "0 0 0 50", "0 0 -1 50", "0 0 Infinity 50", "0 0 100", "0 0 20001 50"]) {
    assert.equal(safeGuideSvgViewBox(value), false, value);
  }
});
