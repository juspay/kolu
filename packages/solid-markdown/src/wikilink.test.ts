import { describe, expect, it } from "vitest";
import { resolveWikilink } from "./wikilink";

describe("resolveWikilink", () => {
  it("resolves a bare target by basename, extension implied", () => {
    // `[[Architecture]]` finds Architecture.md anywhere in the repo.
    expect(
      resolveWikilink({
        target: "Architecture",
        repoPaths: ["src/x.ts", "docs/deep/Architecture.md"],
      }),
    ).toEqual({ kind: "unique", path: "docs/deep/Architecture.md" });
  });

  it("implies ONLY `.md`, not an arbitrary same-stem extension", () => {
    // Regression: `[[lua-filters]]` must resolve to lua-filters.md alone — a
    // same-stemmed `lua-filters.feature` is NOT a candidate (matching any
    // extension made near every wikilink spuriously ambiguous).
    expect(
      resolveWikilink({
        target: "lua-filters",
        repoPaths: [
          "docs/guide/lua-filters.md",
          "tests/features/lua-filters.feature",
        ],
      }),
    ).toEqual({ kind: "unique", path: "docs/guide/lua-filters.md" });
  });

  it("matches a bare extension-less file (`Note` with no `.md`)", () => {
    expect(
      resolveWikilink({ target: "LICENSE", repoPaths: ["LICENSE"] }),
    ).toEqual({ kind: "unique", path: "LICENSE" });
  });

  it("does not match a non-`.md` extension for a bare target", () => {
    // `[[app]]` finds `app` / `app.md` only — never `app.ts`.
    expect(
      resolveWikilink({ target: "app", repoPaths: ["src/app.ts"] }),
    ).toEqual({ kind: "none" });
  });

  it("surfaces candidates when the basename is ambiguous", () => {
    // Two `Note.md` in different directories — a real ambiguity under the
    // `.md`-implied rule.
    const res = resolveWikilink({
      target: "Note",
      repoPaths: ["src/Note.md", "nested/src/Note.md"],
    });
    expect(res).toEqual({
      kind: "ambiguous",
      candidates: ["nested/src/Note.md", "src/Note.md"],
    });
  });

  it("treats a bare name and its `.md` twin as ambiguous", () => {
    expect(
      resolveWikilink({
        target: "CHANGES",
        repoPaths: ["CHANGES", "CHANGES.md"],
      }),
    ).toEqual({ kind: "ambiguous", candidates: ["CHANGES", "CHANGES.md"] });
  });

  it("returns none when nothing matches", () => {
    expect(
      resolveWikilink({ target: "Missing", repoPaths: ["src/app.md"] }),
    ).toEqual({ kind: "none" });
  });

  it("drops a trailing #heading before resolving", () => {
    expect(
      resolveWikilink({
        target: "Architecture#Overview",
        repoPaths: ["docs/Architecture.md"],
      }),
    ).toEqual({ kind: "unique", path: "docs/Architecture.md" });
  });

  it("honours an explicit extension verbatim", () => {
    // `[[logo.png]]` matches the png, not a sibling logo.svg.
    expect(
      resolveWikilink({
        target: "logo.png",
        repoPaths: ["assets/logo.png", "assets/logo.svg"],
      }),
    ).toEqual({ kind: "unique", path: "assets/logo.png" });
  });

  it("narrows a qualified target to the matching directory", () => {
    // `[[docs/guide]]` opens docs/guide.md, never src/guide.md.
    expect(
      resolveWikilink({
        target: "docs/guide",
        repoPaths: ["src/guide.ts", "docs/guide.md"],
      }),
    ).toEqual({ kind: "unique", path: "docs/guide.md" });
  });

  it("a qualified target whose directory is absent is none", () => {
    expect(
      resolveWikilink({ target: "docs/guide", repoPaths: ["src/guide.ts"] }),
    ).toEqual({ kind: "none" });
  });

  it("matches a qualified target against a nested directory tail", () => {
    expect(
      resolveWikilink({
        target: "deep/Architecture",
        repoPaths: ["a/b/deep/Architecture.md", "deep/Other.md"],
      }),
    ).toEqual({ kind: "unique", path: "a/b/deep/Architecture.md" });
  });

  it("resolves an NFD repo path against an NFC target", () => {
    const nfc = "docs/Amélie".normalize("NFC");
    const nfd = `docs/${"Amélie".normalize("NFD")}.md`;
    const res = resolveWikilink({ target: nfc.slice(5), repoPaths: [nfd] });
    // Returns the verbatim (NFD) repo entry, matched under NFC.
    expect(res).toEqual({ kind: "unique", path: nfd });
  });

  it("is none for an empty or heading-only target", () => {
    expect(
      resolveWikilink({ target: "#section", repoPaths: ["a.md"] }),
    ).toEqual({ kind: "none" });
  });
});
