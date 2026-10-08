import { useEffect, useId, useState, type CSSProperties } from "react";
import type { DOMPurify } from "dompurify";
import {
  checkGuideDiagram,
  GUIDE_DIAGRAM_LIMITS,
  safeGuideSvgAttribute,
  safeGuideSvgViewBox,
} from "@/lib/review/guide-diagram-policy";

// Mermaid owns global configuration. Serialize initialization AND rendering, and
// use the same configuration for every job. Theme changes are CSS-only.
let renderQueue: Promise<unknown> = Promise.resolve();
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
// Preserve Mermaid's classic dashed messages after stripping untrusted CSS.
const DIAGRAM_DASH_PATTERN = "3 3";
const SVG_TAGS = [
  "svg",
  "g",
  "defs",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "tspan",
  "title",
  "desc",
];
const SVG_ATTRIBUTES = [
  "id",
  "class",
  "viewBox",
  "preserveAspectRatio",
  "transform",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "width",
  "height",
  "rx",
  "ry",
  "r",
  "cx",
  "cy",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "text-anchor",
  "dominant-baseline",
  "font-size",
  "font-weight",
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
];

class DiagramDisplayError extends Error {}

/** No HTML, CSS, scripts, animation, hrefs or resource-bearing SVG elements. */
export function sanitizeGuideSvg(svg: string, purifier: DOMPurify): string {
  if (svg.length > GUIDE_DIAGRAM_LIMITS.svgCharacters) {
    throw new DiagramDisplayError(
      `Diagram output exceeds ${GUIDE_DIAGRAM_LIMITS.svgCharacters} characters.`,
    );
  }
  const fragment = purifier.sanitize(svg, {
    ALLOWED_TAGS: SVG_TAGS,
    ALLOWED_ATTR: SVG_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const root = fragment.firstElementChild;
  if (!root || root.localName !== "svg" || fragment.childElementCount !== 1) {
    throw new DiagramDisplayError("Diagram did not produce an SVG.");
  }
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > GUIDE_DIAGRAM_LIMITS.svgElements) {
    throw new DiagramDisplayError(
      `Diagram output exceeds ${GUIDE_DIAGRAM_LIMITS.svgElements} elements.`,
    );
  }
  const viewBox = root.getAttribute("viewBox") || "";
  if (!safeGuideSvgViewBox(viewBox)) {
    throw new DiagramDisplayError(
      `Diagram dimensions are missing or exceed ${GUIDE_DIAGRAM_LIMITS.svgDimension} units.`,
    );
  }
  for (const element of elements) {
    if (element.namespaceURI !== SVG_NAMESPACE) {
      throw new DiagramDisplayError("Diagram contains non-SVG content.");
    }
    for (const attribute of Array.from(element.attributes)) {
      if (!safeGuideSvgAttribute(attribute.name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  // Preserve the natural width without trusting Mermaid's inline CSS. The
  // reading-surface CSS scales wide diagrams down, never small diagrams up.
  const [, , intrinsicWidth] = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  root.setAttribute("width", String(intrinsicWidth));
  root.removeAttribute("height");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  return root.outerHTML;
}

async function renderDiagram(source: string, id: string): Promise<string> {
  const [{ default: mermaid }, { default: purifier }] = await Promise.all([
    import("mermaid"),
    import("dompurify"),
  ]);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "neutral",
    htmlLabels: false,
    arrowMarkerAbsolute: false,
    maxTextSize: GUIDE_DIAGRAM_LIMITS.sourceCharacters,
    maxEdges: GUIDE_DIAGRAM_LIMITS.edges,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
  });
  // A connected scratch surface is needed for SVG text measurement. Always
  // dispose it, including syntax failures and components unmounted mid-render.
  const scratch = document.createElement("div");
  scratch.style.position = "fixed";
  scratch.style.visibility = "hidden";
  scratch.style.pointerEvents = "none";
  scratch.setAttribute("aria-hidden", "true");
  document.body.append(scratch);
  try {
    const result = await mermaid.render(id, source, scratch);
    // Deliberately never invoke bindFunctions. Nodes are display-only.
    return sanitizeGuideSvg(result.svg, purifier);
  } finally {
    scratch.remove();
  }
}

function diagramCaption(source: string): string {
  const description = source.match(/^[ \t]*accDescr[ \t]*:[ \t]*(.+)$/m)?.[1];
  if (description) return description;
  const blockDescription = source.match(/^\s*accDescr\s*\{([\s\S]*?)\}/m)?.[1].trim();
  if (blockDescription) return blockDescription;
  const title = source.match(/^[ \t]*accTitle[ \t]*:[ \t]*(.+)$/m)?.[1];
  if (title) return title;
  if (source.trimStart().startsWith("sequenceDiagram")) {
    return "Sequence diagram showing the order of messages. Read the surrounding explanation for context.";
  }
  return "Flowchart showing relationships between steps. Read the surrounding explanation for context.";
}

type DiagramResult = { source: string; svg?: string; error?: string };

export function GuideDiagram({ source }: { source: string }) {
  const id = `guide-diagram-${useId().replace(/[^\w-]/g, "")}`;
  const [result, setResult] = useState<DiagramResult | null>(null);
  const policy = checkGuideDiagram(source);
  const caption = diagramCaption(source);

  useEffect(() => {
    if (!checkGuideDiagram(source).valid) return;
    let disposed = false;
    const job = renderQueue.then(() => {
      if (disposed) return undefined;
      return renderDiagram(source, id);
    });
    // A failed diagram must not poison the queue for the next diagram.
    renderQueue = job.catch(() => undefined);
    void job.then(
      (svg) => {
        if (!disposed && svg) setResult({ source, svg });
      },
      (error: unknown) => {
        if (!disposed) {
          let message = "Diagram could not be rendered. Check its syntax or display limits.";
          if (error instanceof DiagramDisplayError) message = error.message;
          setResult({ source, error: message });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [source, id]);

  let error: string | undefined;
  if (!policy.valid) error = policy.reason;
  if (result?.source === source && result.error) error = result.error;
  const svg = result?.source === source ? result.svg : undefined;

  return (
    <figure className="my-3 min-w-0 max-w-full rounded-md border border-border bg-background p-3">
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          Diagram unavailable: {error}
        </p>
      )}
      {!error && !svg && (
        <p role="status" className="text-sm text-muted-foreground">
          Rendering diagram…
        </p>
      )}
      {svg && !error && (
        <div
          role="img"
          aria-label={caption}
          style={{ "--guide-diagram-dash": DIAGRAM_DASH_PATTERN } as CSSProperties}
          className="guide-diagram-image"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
