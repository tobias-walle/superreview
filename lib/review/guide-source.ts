export const GUIDE_SOURCE_CONTEXT_LINES = 5;

export type GuideSourceLine = {
  number: number;
  text: string;
  selected: boolean;
};

/** Build a numbered captured-source view without consulting the live worktree. */
export function guideSourceLines(
  source: string,
  range: { start: number; end: number },
  full: boolean,
): GuideSourceLine[] {
  const lines = source.split("\n");
  if (source.endsWith("\n")) lines.pop();
  const first = full ? 1 : Math.max(1, range.start - GUIDE_SOURCE_CONTEXT_LINES);
  const last = full ? lines.length : Math.min(lines.length, range.end + GUIDE_SOURCE_CONTEXT_LINES);
  return lines.slice(first - 1, last).map((text, index) => {
    const number = first + index;
    return {
      number,
      text: text.endsWith("\r") ? text.slice(0, -1) : text,
      selected: number >= range.start && number <= range.end,
    };
  });
}
