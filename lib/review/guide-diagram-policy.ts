// These display limits bound parsing/layout work, not guide coverage. Syntax errors
// remain renderer warnings. Keep this policy independent of the DOM and Mermaid.
export const GUIDE_DIAGRAM_LIMITS = Object.freeze({
  sourceCharacters: 12_000,
  lines: 160,
  lineCharacters: 400,
  statements: 160,
  tokens: 1_200,
  edges: 100,
  nesting: 8,
  svgCharacters: 500_000,
  svgElements: 3_000,
  svgDimension: 20_000,
});

export type GuideDiagramPolicy = { valid: true } | { valid: false; reason: string };

export function checkGuideDiagram(source: string): GuideDiagramPolicy {
  const reject = (reason: string): GuideDiagramPolicy => ({ valid: false, reason });
  if (source.length > GUIDE_DIAGRAM_LIMITS.sourceCharacters) {
    return reject(`Diagram exceeds ${GUIDE_DIAGRAM_LIMITS.sourceCharacters} characters.`);
  }
  const lines = source.trim().split(/\r?\n/);
  if (lines.length > GUIDE_DIAGRAM_LIMITS.lines) {
    return reject(`Diagram exceeds ${GUIDE_DIAGRAM_LIMITS.lines} lines.`);
  }
  if (lines.some((line) => line.length > GUIDE_DIAGRAM_LIMITS.lineCharacters)) {
    return reject(
      `Diagram lines must not exceed ${GUIDE_DIAGRAM_LIMITS.lineCharacters} characters.`,
    );
  }
  const hasControlCharacters = Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && character !== "\n" && character !== "\r" && character !== "\t";
  });
  // Inspect comments too: directives are processed before diagram syntax. Modern
  // resource-bearing shapes and Markdown/HTML labels are outside our subset.
  if (hasControlCharacters || /%%\s*\{|^\s*---|@\s*\{|`/m.test(source)) {
    return reject("Diagram configuration directives and rich labels are not allowed.");
  }
  if (/<\s*\/?\s*[a-z!]|&(?:#\w+|[a-z][\w]+);|#(?:[a-z][\w]*|\d+);/i.test(source)) {
    return reject("Diagram HTML labels and encoded markup are not allowed.");
  }
  if (
    /(?:[a-z][\w+.-]*:\/\/|\/\/)|\b(?:https?|data|javascript|file|blob):|url\s*\(/i.test(source)
  ) {
    return reject("Diagram external resources are not allowed.");
  }
  // Ban statements, not words inside labels/messages such as "call the service".
  // Semicolons can start another statement on the same line.
  const maskedLabels = source.replace(/"[^"]*"|\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, "label");
  const statements = maskedLabels.replace(/%%[^\n]*|:[^\n]*/g, "");
  if (
    /(?:^|[;\n])\s*(?:click|href|links?|callback|call|init|initialize|config|classDef|class|style|linkStyle|image|icon)\s+[^\n;]+/i.test(
      statements,
    )
  ) {
    return reject("Diagram actions, styles and links are not allowed.");
  }
  if (/:::\s*[\w-]+/.test(maskedLabels)) {
    return reject("Diagram custom classes are not allowed.");
  }
  const content = lines.filter((line) => line.trim() && !line.trim().startsWith("%%"));
  if (!/^(?:flowchart\s+(?:TB|TD|BT|LR|RL)|sequenceDiagram)\s*;?\s*$/.test(content[0] ?? "")) {
    return reject("Only flowchart and sequenceDiagram diagrams are supported.");
  }
  if (source.split(/[;\n]/).length > GUIDE_DIAGRAM_LIMITS.statements) {
    return reject(`Diagram exceeds ${GUIDE_DIAGRAM_LIMITS.statements} statements.`);
  }
  if ((source.match(/[\w-]+|[^\s\w]/g)?.length ?? 0) > GUIDE_DIAGRAM_LIMITS.tokens) {
    return reject(`Diagram exceeds ${GUIDE_DIAGRAM_LIMITS.tokens} syntax tokens.`);
  }
  if ((source.match(/[-=~.]+(?:>|x|o)|<[-=~.]+/g)?.length ?? 0) > GUIDE_DIAGRAM_LIMITS.edges) {
    return reject(`Diagram exceeds ${GUIDE_DIAGRAM_LIMITS.edges} edges or messages.`);
  }
  let nesting = 0;
  for (const statement of statements.split(/[;\n]/)) {
    if (/^\s*(?:subgraph|loop|alt|opt|par|critical|break|rect|box)\b/.test(statement)) {
      nesting += 1;
    }
    if (/^\s*end\b/.test(statement)) nesting = Math.max(0, nesting - 1);
    if (nesting > GUIDE_DIAGRAM_LIMITS.nesting) {
      return reject(`Diagram nesting exceeds ${GUIDE_DIAGRAM_LIMITS.nesting} levels.`);
    }
  }
  return { valid: true };
}

/** Paint/marker URLs may reference only definitions within this SVG. */
export function safeGuideSvgAttribute(name: string, value: string): boolean {
  if (/^(?:href|xlink:href|src|style|filter|mask|clip-path|cursor|on\w+)$/i.test(name)) {
    return false;
  }
  if (name === "width" || name === "height") {
    const dimension = Number(value.replace(/(?:px|%)$/, ""));
    const limit = value.endsWith("%") ? 100 : GUIDE_DIAGRAM_LIMITS.svgDimension;
    return Number.isFinite(dimension) && dimension >= 0 && dimension <= limit;
  }
  if (name === "fill" || name === "stroke") {
    return /^(?:none|currentColor|transparent|#[\da-f]{3,8}|[a-z]+)$/i.test(value);
  }
  if (name.startsWith("marker-")) {
    return /^url\(#[\w-]+\)$/.test(value);
  }
  return true;
}

export function safeGuideSvgViewBox(value: string): boolean {
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) {
    return false;
  }
  const [x, y, width, height] = numbers;
  const limit = GUIDE_DIAGRAM_LIMITS.svgDimension;
  return (
    Math.abs(x) <= limit &&
    Math.abs(y) <= limit &&
    width > 0 &&
    height > 0 &&
    width <= limit &&
    height <= limit
  );
}
