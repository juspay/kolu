import { describe, expect, it } from "vitest";
import {
  type PreviewPathCodec,
  pathFromPreviewPathname,
  resolveLinkHref,
  resolveRelativePath,
} from "./linkNav";

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

describe("pathFromPreviewPathname", () => {
  // A representative per-segment codec — same shape as a host's real
  // preview-URL encoding (kolu's `encodePreviewPath`): each path segment is
  // percent-encoded independently, separators preserved.
  const codec: PreviewPathCodec = {
    encode: (p) => p.split("/").map(encodeURIComponent).join("/"),
    decode: (s) => s.split("/").map(decodeURIComponent).join("/"),
  };
  const PREFIX = "/api/terminals/t-1/file";
  const url = (path: string) => `${PREFIX}/${codec.encode(path)}?v=1`;
  const reported = (path: string) => `${PREFIX}/${codec.encode(path)}`;

  it("maps a sibling link in the root", () => {
    expect(
      pathFromPreviewPathname(
        reported("second.html"),
        url("first.html"),
        "first.html",
        codec,
      ),
    ).toBe("second.html");
  });

  it("maps a sibling link inside a subdirectory", () => {
    expect(
      pathFromPreviewPathname(
        reported("docs/b.html"),
        url("docs/a.html"),
        "docs/a.html",
        codec,
      ),
    ).toBe("docs/b.html");
  });

  it("maps a parent-relative link the browser already resolved", () => {
    expect(
      pathFromPreviewPathname(
        reported("other.html"),
        url("docs/a.html"),
        "docs/a.html",
        codec,
      ),
    ).toBe("other.html");
  });

  it("round-trips percent-encoded path segments", () => {
    expect(
      pathFromPreviewPathname(
        reported("my notes/page two.html"),
        url("my notes/page one.html"),
        "my notes/page one.html",
        codec,
      ),
    ).toBe("my notes/page two.html");
  });

  it("returns the same path for a reload of the current file (no-op)", () => {
    expect(
      pathFromPreviewPathname(
        reported("first.html"),
        url("first.html"),
        "first.html",
        codec,
      ),
    ).toBe("first.html");
  });

  it("returns null when the iframe navigated outside the preview route", () => {
    expect(
      pathFromPreviewPathname(
        "/some/other/place.html",
        url("first.html"),
        "first.html",
        codec,
      ),
    ).toBeNull();
  });

  it("returns null when the reported pathname is just the prefix", () => {
    expect(
      pathFromPreviewPathname(
        `${PREFIX}/`,
        url("first.html"),
        "first.html",
        codec,
      ),
    ).toBeNull();
  });

  it("returns null when currentUrl doesn't end with the encoded current path", () => {
    expect(
      pathFromPreviewPathname(
        reported("second.html"),
        url("mismatch.html"),
        "first.html",
        codec,
      ),
    ).toBeNull();
  });

  it("returns null for a malformed percent-sequence", () => {
    expect(
      pathFromPreviewPathname(
        `${PREFIX}/%E0%A4%A.html`,
        url("first.html"),
        "first.html",
        codec,
      ),
    ).toBeNull();
  });

  describe("round-trips the codec for any document path", () => {
    const navigate = (from: string, to: string): string | null =>
      pathFromPreviewPathname(reported(to), url(from), from, codec);
    it.each([
      { from: "first.html", to: "second.html" },
      { from: "docs/a.html", to: "docs/b.html" },
      { from: "docs/a.html", to: "other.html" },
      { from: "a.html", to: "deep/nested/dir/b.html" },
      { from: "my notes/page one.html", to: "my notes/page two.html" },
      { from: "weird & name.html", to: "100%/=done?.html" },
      { from: "café/résumé.html", to: "naïve/façade.html" },
    ])("$from → $to", ({ from, to }) => {
      expect(navigate(from, to)).toBe(to);
    });
  });
});
