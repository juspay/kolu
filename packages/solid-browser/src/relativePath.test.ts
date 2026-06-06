import { describe, expect, it } from "vitest";
import { resolveLinkHref, resolveRelativePath } from "./relativePath";

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
