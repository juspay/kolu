import { describe, expect, it } from "vitest";
import {
  resolveMarkdownImageSrc,
  resolveMarkdownLinkPath,
} from "./markdownImageSrc";

const resolve = (mdPath: string, src: string) =>
  resolveMarkdownImageSrc("term-1", mdPath, src);

describe("resolveMarkdownImageSrc", () => {
  it("resolves a sibling image against the markdown file's directory", () => {
    expect(resolve("docs/readme.md", "logo.png")).toBe(
      "/api/terminals/term-1/file/docs/logo.png",
    );
    expect(resolve("docs/readme.md", "./logo.png")).toBe(
      "/api/terminals/term-1/file/docs/logo.png",
    );
  });

  it("resolves a top-level markdown image from the repo root", () => {
    expect(resolve("README.md", "assets/icon.svg")).toBe(
      "/api/terminals/term-1/file/assets/icon.svg",
    );
  });

  it("collapses ../ against the file's directory", () => {
    expect(resolve("docs/guide/readme.md", "../img/x.png")).toBe(
      "/api/terminals/term-1/file/docs/img/x.png",
    );
  });

  it("treats a root-absolute src as repo-root-relative", () => {
    expect(resolve("docs/readme.md", "/img/x.png")).toBe(
      "/api/terminals/term-1/file/img/x.png",
    );
  });

  it("percent-encodes path segments", () => {
    expect(resolve("README.md", "my images/a b.png")).toBe(
      "/api/terminals/term-1/file/my%20images/a%20b.png",
    );
  });

  it("returns undefined for srcs that aren't repo-relative", () => {
    expect(
      resolve("README.md", "https://cdn.example.com/x.png"),
    ).toBeUndefined();
    expect(resolve("README.md", "data:image/png;base64,AAAA")).toBeUndefined();
    expect(resolve("README.md", "//cdn.example.com/x.png")).toBeUndefined();
    expect(resolve("README.md", "#section")).toBeUndefined();
    expect(resolve("README.md", "   ")).toBeUndefined();
  });

  it("returns undefined when the path escapes the repo root", () => {
    expect(resolve("README.md", "../../etc/passwd")).toBeUndefined();
    expect(resolve("docs/readme.md", "../../../secret")).toBeUndefined();
  });

  it("decodes URL-escaped segments so they aren't double-encoded", () => {
    // `my%20images` names a `my images` dir on disk; the route re-encodes once.
    expect(resolve("README.md", "my%20images/logo.png")).toBe(
      "/api/terminals/term-1/file/my%20images/logo.png",
    );
  });

  it("rejects a separator/traversal smuggled through an escape", () => {
    expect(resolve("README.md", "a%2f..%2f..%2fetc")).toBeUndefined();
    expect(resolve("README.md", "%2e%2e/secret")).toBeUndefined();
    expect(resolve("README.md", "bad%ZZ.png")).toBeUndefined();
  });
});

describe("resolveMarkdownLinkPath", () => {
  it("resolves a link against the previewed doc's directory", () => {
    expect(resolveMarkdownLinkPath("README.md", "docs/guide.md")).toBe(
      "docs/guide.md",
    );
    expect(resolveMarkdownLinkPath("docs/index.md", "guide.md")).toBe(
      "docs/guide.md",
    );
    expect(resolveMarkdownLinkPath("docs/a/b.md", "../c.md")).toBe("docs/c.md");
  });

  it("treats a root-absolute href as repo-root-relative", () => {
    expect(resolveMarkdownLinkPath("docs/index.md", "/LICENSE")).toBe(
      "LICENSE",
    );
  });

  it("strips a #fragment or ?query before resolving (#1161 scope)", () => {
    // The file opens; scrolling to the in-doc heading is out of scope.
    expect(resolveMarkdownLinkPath("README.md", "docs/guide.md#install")).toBe(
      "docs/guide.md",
    );
    expect(resolveMarkdownLinkPath("README.md", "docs/guide.md?v=2")).toBe(
      "docs/guide.md",
    );
  });

  it("returns null for external / own-scheme hrefs", () => {
    expect(
      resolveMarkdownLinkPath("README.md", "https://example.com/"),
    ).toBeNull();
    expect(resolveMarkdownLinkPath("README.md", "mailto:a@b.c")).toBeNull();
    expect(
      resolveMarkdownLinkPath("README.md", "//cdn.example.com"),
    ).toBeNull();
    expect(resolveMarkdownLinkPath("README.md", "#section")).toBeNull();
    expect(resolveMarkdownLinkPath("README.md", "   ")).toBeNull();
  });

  it("returns null when the href escapes the repo root", () => {
    expect(resolveMarkdownLinkPath("README.md", "../../etc/passwd")).toBeNull();
    expect(resolveMarkdownLinkPath("docs/a.md", "../../../secret")).toBeNull();
  });
});
