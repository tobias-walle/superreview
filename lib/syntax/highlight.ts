import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import latteTheme from "shiki/themes/catppuccin-latte.mjs";
import mochaTheme from "shiki/themes/catppuccin-mocha.mjs";
import type { Hunk } from "@/lib/diff/render";

const MAX_HIGHLIGHTED_LINE_LENGTH = 4_000;
const MAX_HIGHLIGHTED_FILE_LENGTH = 500_000;
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
const hunkCache = new WeakMap<Hunk, Map<string, Promise<HunkHighlight | undefined>>>();
const fileCache = new Map<
  string,
  Promise<{ old: SyntaxToken[][]; new: SyntaxToken[][] } | undefined>
>();

export type HighlightSources = {
  old: string;
  new: string;
  key: string;
};

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

function syntaxTokens(highlighted: ReturnType<HighlighterCore["codeToTokensWithThemes"]>) {
  return highlighted.map((line) =>
    line.map((token) => ({
      text: token.content,
      mocha: token.variants.mocha.color || "inherit",
      latte: token.variants.latte.color || "inherit",
      fontStyle: token.variants.mocha.fontStyle || 0,
    })),
  );
}

async function highlightFile(sources: HighlightSources, language: Language) {
  const sourceLines = [sources.old.split("\n"), sources.new.split("\n")];
  if (
    sources.old.length > MAX_HIGHLIGHTED_FILE_LENGTH ||
    sources.new.length > MAX_HIGHLIGHTED_FILE_LENGTH ||
    sourceLines.some((lines) => lines.some((line) => line.length > MAX_HIGHLIGHTED_LINE_LENGTH))
  )
    return undefined;

  await loadLanguage(language);
  const highlighter = await getHighlighter();
  return {
    old: syntaxTokens(
      highlighter.codeToTokensWithThemes(sources.old, {
        lang: language,
        themes: { mocha: MOCHA_THEME, latte: LATTE_THEME },
      }),
    ),
    new: syntaxTokens(
      highlighter.codeToTokensWithThemes(sources.new, {
        lang: language,
        themes: { mocha: MOCHA_THEME, latte: LATTE_THEME },
      }),
    ),
  };
}

function hunkHighlight(
  hunk: Hunk,
  highlighted: { old: SyntaxToken[][]; new: SyntaxToken[][] },
): HunkHighlight {
  const old = new Map<number, SyntaxToken[]>();
  const next = new Map<number, SyntaxToken[]>();
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  let sourceIndex = 0;
  for (const rawLine of hunk.lines) {
    if (rawLine.startsWith("\\")) continue;
    const kind = rawLine[0];
    if (kind !== "+") old.set(sourceIndex, highlighted.old[oldLine++ - 1] || []);
    if (kind !== "-") next.set(sourceIndex, highlighted.new[newLine++ - 1] || []);
    sourceIndex++;
  }
  return { old, new: next };
}

function hunkSources(hunk: Hunk): HighlightSources {
  return {
    old: sideSource(hunk, "old").lines.join("\n"),
    new: sideSource(hunk, "new").lines.join("\n"),
    key: "hunk",
  };
}

export function highlightHunk(path: string, hunk: Hunk, fullSources?: HighlightSources) {
  const language = languageForPath(path);
  if (!language) return Promise.resolve(undefined);
  const sources = fullSources || hunkSources(hunk);
  const cacheKey = `${language}:${sources.key}`;

  let bySource = hunkCache.get(hunk);
  if (!bySource) {
    bySource = new Map();
    hunkCache.set(hunk, bySource);
  }
  let pending = bySource.get(cacheKey);
  if (!pending) {
    let file = fullSources ? fileCache.get(cacheKey) : undefined;
    if (!file) {
      file = highlightFile(sources, language);
      if (fullSources) fileCache.set(cacheKey, file);
    }
    pending = file
      .then((highlighted) => (highlighted ? hunkHighlight(hunk, highlighted) : undefined))
      .catch((error) => {
        console.warn(`Syntax highlighting failed for ${path}`, error);
        return undefined;
      });
    bySource.set(cacheKey, pending);
  }
  return pending;
}
