import { encodePreviewPath } from "kolu-common/preview";
import { describe, expect, it } from "vitest";
import { repoPathFromPreviewPathname } from "./iframePreviewNav";

// `currentUrl` is always a `buildIframePreviewUrl` output:
//   /api/terminals/{id}/file/{encoded/path}?v=<mtime>
// The reported pathname is the in-iframe `location.pathname` after a link
// click — same prefix, no query, `..` already resolved by the browser.
const PREFIX = "/api/terminals/t-1/file";

describe("repoPathFromPreviewPathname", () => {
  it("maps a sibling link in the repo root", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/second.html`,
        `${PREFIX}/first.html?v=123`,
        "first.html",
      ),
    ).toBe("second.html");
  });

  it("maps a sibling link inside a subdirectory", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/docs/b.html`,
        `${PREFIX}/docs/a.html?v=9`,
        "docs/a.html",
      ),
    ).toBe("docs/b.html");
  });

  it("maps a parent-relative link the browser already resolved", () => {
    // `<a href="../other.html">` from docs/a.html → /file/other.html.
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/other.html`,
        `${PREFIX}/docs/a.html?v=9`,
        "docs/a.html",
      ),
    ).toBe("other.html");
  });

  it("round-trips percent-encoded path segments", () => {
    // buildIframePreviewUrl encodes per segment; location.pathname keeps it
    // encoded, so decoding must invert it exactly.
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/my%20notes/page%20two.html`,
        `${PREFIX}/my%20notes/page%20one.html?v=1`,
        "my notes/page one.html",
      ),
    ).toBe("my notes/page two.html");
  });

  it("returns the same path for a reload of the current file (no-op)", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/first.html`,
        `${PREFIX}/first.html?v=123`,
        "first.html",
      ),
    ).toBe("first.html");
  });

  it("returns null when the iframe navigated outside the file route", () => {
    // An absolute external link — pathname doesn't share the route prefix.
    expect(
      repoPathFromPreviewPathname(
        "/some/other/place.html",
        `${PREFIX}/first.html?v=1`,
        "first.html",
      ),
    ).toBeNull();
  });

  it("returns null when the reported pathname is just the prefix", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/`,
        `${PREFIX}/first.html?v=1`,
        "first.html",
      ),
    ).toBeNull();
  });

  it("returns null when currentUrl doesn't end with the encoded current path", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/second.html`,
        `${PREFIX}/mismatch.html?v=1`,
        "first.html",
      ),
    ).toBeNull();
  });

  it("returns null for a malformed percent-sequence", () => {
    expect(
      repoPathFromPreviewPathname(
        `${PREFIX}/%E0%A4%A.html`,
        `${PREFIX}/first.html?v=1`,
        "first.html",
      ),
    ).toBeNull();
  });

  // Round-trip against the SHARED `kolu-common/preview` codec — the same
  // encoder `buildIframePreviewUrl` uses server-side. This is the guard that
  // matters: if the encoding scheme ever changes, the inversion must still
  // invert it. Building inputs via `encodePreviewPath` (rather than a
  // hand-written encoded string) pins the test to the real encoder, so a
  // change there that `repoPathFromPreviewPathname` no longer inverts fails
  // here at the unit layer instead of only at e2e.
  describe("round-trips encodePreviewPath for any repo path", () => {
    const navigate = (from: string, to: string): string | null => {
      const currentUrl = `${PREFIX}/${encodePreviewPath(from)}?v=1`;
      const reported = `${PREFIX}/${encodePreviewPath(to)}`;
      return repoPathFromPreviewPathname(reported, currentUrl, from);
    };
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
