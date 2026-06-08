import { describe, expect, it } from "vitest";
import { type PreviewPathCodec, pathFromPreviewPathname } from "./previewPath";

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
