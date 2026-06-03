import { describe, expect, it } from "vitest";
import { resolveMarkdownImageSrc } from "./markdownImageSrc";

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
