import {
  DEFAULT_THEMES,
  disposeHighlighter,
  getFiletypeFromFileName,
  getSharedHighlighter,
} from "@pierre/diffs";
import { afterAll, describe, expect, it } from "vitest";
import { registerRhaiLanguage } from "./rhai";

describe("Rhai syntax highlighting", () => {
  afterAll(async () => {
    await disposeHighlighter();
  });

  it("detects .rhai files and tokenizes them with Kolu's JS engine", async () => {
    registerRhaiLanguage();

    expect(getFiletypeFromFileName("scripts/example.rhai")).toBe("rhai");

    const highlighter = await getSharedHighlighter({
      themes: Object.values(DEFAULT_THEMES),
      langs: ["rhai"],
      preferredHighlighter: "shiki-js",
    });
    const { tokens } = highlighter.codeToTokens('let message = "hello";', {
      lang: "rhai",
      theme: DEFAULT_THEMES.dark,
    });
    const line = tokens[0] ?? [];

    expect(line.map((token) => token.content)).toContain("let");
    expect(new Set(line.map((token) => token.color)).size).toBeGreaterThan(1);
  });
});
