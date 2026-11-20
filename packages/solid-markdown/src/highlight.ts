import type { Highlighter } from "shiki";

export const SHIKI_LIGHT = "github-light";
export const SHIKI_DARK = "github-dark";

export const LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "jsonc",
  "html",
  "xml",
  "css",
  "scss",
  "markdown",
  "bash",
  "shellscript",
  "python",
  "ruby",
  "go",
  "rust",
  "c",
  "cpp",
  "java",
  "kotlin",
  "swift",
  "php",
  "sql",
  "yaml",
  "toml",
  "ini",
  "docker",
  "diff",
  "graphql",
  "lua",
  "nix",
  "haskell",
  "elixir",
  "make",
  "perl",
] as const;

export const ALIAS: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  console: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  "c++": "cpp",
  h: "c",
  hpp: "cpp",
  yml: "yaml",
  md: "markdown",
  dockerfile: "docker",
  kt: "kotlin",
  ex: "elixir",
};

const SUPPORTED = new Set<string>(LANGS);

let highlighter: Highlighter | null = null;
let loadPromise: Promise<Highlighter> | null = null;

export function loadHighlighter(): Promise<Highlighter> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      highlighter = await createHighlighter({
        themes: [SHIKI_LIGHT, SHIKI_DARK],
        langs: [...LANGS],
      });
      return highlighter;
    })();
  }
  return loadPromise;
}

export function highlightCode(code: string, lang: string): string | undefined {
  if (!highlighter) return undefined;
  const key = lang.toLowerCase();
  const resolved = ALIAS[key] ?? key;
  const useLang = SUPPORTED.has(resolved) ? resolved : "text";
  try {
    return highlighter.codeToHtml(code, {
      lang: useLang,
      themes: { light: SHIKI_LIGHT, dark: SHIKI_DARK },
      defaultColor: false,
    });
  } catch (err) {
    console.warn(
      `shiki: failed to highlight ${useLang} block, falling back to plain`,
      err,
    );
    return undefined;
  }
}
