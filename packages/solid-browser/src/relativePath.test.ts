import { describe, expect, it } from "vitest";
import {
  resolveLinkHref,
  resolveRelativePath,
  resolveWikilink,
} from "./relativePath";

describe("resolveRelativePath", () => {
  it("resolves a sibling ref against the source document's directory", () => {
    expect(resolveRelativePath("docs/readme.md", "logo.png")).toBe(
      "docs/logo.png",
    );
    expect(resolveRelativePath("docs/readme.md", "./logo.png")).toBe(
      "docs/logo.png",
    );
  });

  it("resolves a top-level ref from the root", () => {
    expect(resolveRelativePath("README.md", "assets/icon.svg")).toBe(
      "assets/icon.svg",
    );
  });

  it("collapses ../ against the document's directory", () => {
    expect(resolveRelativePath("docs/guide/readme.md", "../img/x.png")).toBe(
      "docs/img/x.png",
    );
  });

  it("treats a root-absolute ref as root-relative", () => {
    expect(resolveRelativePath("docs/readme.md", "/img/x.png")).toBe(
      "img/x.png",
    );
  });

  it("decodes URL-escaped segments so a re-encoding host can't double-encode", () => {
    expect(resolveRelativePath("README.md", "my%20images/logo.png")).toBe(
      "my images/logo.png",
    );
  });

  it("returns null for refs that carry their own origin/scheme", () => {
    expect(
      resolveRelativePath("README.md", "https://cdn.example.com/x.png"),
    ).toBeNull();
    expect(
      resolveRelativePath("README.md", "data:image/png;base64,AAAA"),
    ).toBeNull();
    expect(
      resolveRelativePath("README.md", "//cdn.example.com/x.png"),
    ).toBeNull();
    expect(resolveRelativePath("README.md", "#section")).toBeNull();
    expect(resolveRelativePath("README.md", "   ")).toBeNull();
  });

  it("returns null when the path escapes the root", () => {
    expect(resolveRelativePath("README.md", "../../etc/passwd")).toBeNull();
    expect(resolveRelativePath("docs/readme.md", "../../../secret")).toBeNull();
  });

  it("rejects a separator/traversal smuggled through an escape", () => {
    expect(resolveRelativePath("README.md", "a%2f..%2f..%2fetc")).toBeNull();
    expect(resolveRelativePath("README.md", "%2e%2e/secret")).toBeNull();
    expect(resolveRelativePath("README.md", "bad%ZZ.png")).toBeNull();
  });
});

describe("resolveLinkHref", () => {
  it("resolves a link against the source document's directory", () => {
    expect(resolveLinkHref("README.md", "docs/guide.md")).toBe("docs/guide.md");
    expect(resolveLinkHref("docs/index.md", "guide.md")).toBe("docs/guide.md");
    expect(resolveLinkHref("docs/a/b.md", "../c.md")).toBe("docs/c.md");
  });

  it("treats a root-absolute href as root-relative", () => {
    expect(resolveLinkHref("docs/index.md", "/LICENSE")).toBe("LICENSE");
  });

  it("strips a #fragment or ?query before resolving", () => {
    // The document opens; scrolling to the in-doc heading is the host's concern.
    expect(resolveLinkHref("README.md", "docs/guide.md#install")).toBe(
      "docs/guide.md",
    );
    expect(resolveLinkHref("README.md", "docs/guide.md?v=2")).toBe(
      "docs/guide.md",
    );
  });

  it("returns null for external / own-scheme hrefs", () => {
    expect(resolveLinkHref("README.md", "https://example.com/")).toBeNull();
    expect(resolveLinkHref("README.md", "mailto:a@b.c")).toBeNull();
    expect(resolveLinkHref("README.md", "//cdn.example.com")).toBeNull();
    expect(resolveLinkHref("README.md", "#section")).toBeNull();
    expect(resolveLinkHref("README.md", "   ")).toBeNull();
  });

  it("returns null when the href escapes the root", () => {
    expect(resolveLinkHref("README.md", "../../etc/passwd")).toBeNull();
    expect(resolveLinkHref("docs/a.md", "../../../secret")).toBeNull();
  });
});

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
