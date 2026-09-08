import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import latteTheme from "shiki/themes/catppuccin-latte.mjs";
import mochaTheme from "shiki/themes/catppuccin-mocha.mjs";
import type { Hunk } from "@/lib/diff/render";

const MAX_HIGHLIGHTED_LINE_LENGTH = 4_000;
const MAX_HIGHLIGHTED_HUNK_LENGTH = 500_000;
const MOCHA_THEME = "catppuccin-mocha";
const LATTE_THEME = "catppuccin-latte";

const SPECIAL_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  gemfile: "ruby",
  makefile: "make",
  rakefile: "ruby",
  justfile: "just",
  "package-lock.json": "json",
  "pnpm-lock.yaml": "yaml",
  "pnpm-lock.yml": "yaml",
  "yarn.lock": "yaml",
  ".bashrc": "bash",
  ".dockerignore": "ignore",
  ".editorconfig": "ini",
  ".env": "dotenv",
  ".gitattributes": "git-commit",
  ".gitignore": "ignore",
  ".npmrc": "ini",
  ".prettierrc": "json",
};

const EXTENSION_ALIASES: Record<string, string> = {
  cjs: "javascript",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  m: "objective-c",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  plist: "xml",
  text: "plaintext",
  txt: "plaintext",
};

export type SyntaxToken = {
  text: string;
  mocha: string;
  latte: string;
  fontStyle: number;
};

export type HunkHighlight = {
  old: Map<number, SyntaxToken[]>;
  new: Map<number, SyntaxToken[]>;
};

type Language = keyof typeof bundledLanguages;
let highlighterPromise: Promise<HighlighterCore> | undefined;
const languagePromises = new Map<Language, Promise<void>>();
const hunkCache = new WeakMap<Hunk, Map<Language, Promise<HunkHighlight | undefined>>>();

function isLanguage(value: string): value is Language {
  return value in bundledLanguages;
}

export function languageForPath(path: string): Language | undefined {
  const filename = path.split("/").at(-1)?.toLowerCase() || "";
  const special = SPECIAL_FILENAMES[filename];
  if (special && isLanguage(special)) return special;

  const extension = filename.includes(".") ? filename.split(".").at(-1)! : "";
  const language = EXTENSION_ALIASES[extension] || extension;
  return isLanguage(language) ? language : undefined;
}

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    langs: [],
    themes: [mochaTheme, latteTheme],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

async function loadLanguage(language: Language) {
  let pending = languagePromises.get(language);
  if (!pending) {
    pending = getHighlighter().then(async (highlighter) => {
      await highlighter.loadLanguage(bundledLanguages[language]);
    });
    languagePromises.set(language, pending);
  }
  await pending;
}

function sideSource(hunk: Hunk, side: "old" | "new") {
  const sourceIndexes: number[] = [];
  const lines: string[] = [];
  let sourceIndex = 0;
  for (const rawLine of hunk.lines) {
    if (rawLine.startsWith("\\")) continue;
    const kind = rawLine[0];
    const belongsToSide = side === "old" ? kind !== "+" : kind !== "-";
    if (belongsToSide) {
      sourceIndexes.push(sourceIndex);
      lines.push(rawLine.slice(1));
    }
    sourceIndex++;
  }
  return { sourceIndexes, lines };
}

async function highlightSide(
  highlighter: HighlighterCore,
  hunk: Hunk,
  side: "old" | "new",
  language: Language,
) {
  const { sourceIndexes, lines } = sideSource(hunk, side);
  const highlighted = highlighter.codeToTokensWithThemes(lines.join("\n"), {
    lang: language,
    themes: { mocha: MOCHA_THEME, latte: LATTE_THEME },
  });
  return new Map(
    sourceIndexes.map((sourceIndex, index) => [
      sourceIndex,
      (highlighted[index] || []).map((token) => ({
        text: token.content,
        mocha: token.variants.mocha.color || "inherit",
        latte: token.variants.latte.color || "inherit",
        fontStyle: token.variants.mocha.fontStyle || 0,
      })),
    ]),
  );
}

async function createHunkHighlight(hunk: Hunk, language: Language) {
  const contentLength = hunk.lines.reduce((length, line) => length + line.length, 0);
  if (
    contentLength > MAX_HIGHLIGHTED_HUNK_LENGTH ||
    hunk.lines.some((line) => line.length > MAX_HIGHLIGHTED_LINE_LENGTH)
  )
    return undefined;

  await loadLanguage(language);
  const highlighter = await getHighlighter();
  const [old, next] = await Promise.all([
    highlightSide(highlighter, hunk, "old", language),
    highlightSide(highlighter, hunk, "new", language),
  ]);
  return { old, new: next };
}

export function highlightHunk(path: string, hunk: Hunk) {
  const language = languageForPath(path);
  if (!language) return Promise.resolve(undefined);

  let byLanguage = hunkCache.get(hunk);
  if (!byLanguage) {
    byLanguage = new Map();
    hunkCache.set(hunk, byLanguage);
  }
  let pending = byLanguage.get(language);
  if (!pending) {
    pending = createHunkHighlight(hunk, language).catch((error) => {
      console.warn(`Syntax highlighting failed for ${path}`, error);
      return undefined;
    });
    byLanguage.set(language, pending);
  }
  return pending;
}
