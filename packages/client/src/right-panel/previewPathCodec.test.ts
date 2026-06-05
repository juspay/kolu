import { pathFromPreviewPathname } from "@kolu/solid-browser";
import { decodePreviewPath, encodePreviewPath } from "kolu-common/preview";
import { describe, expect, it } from "vitest";

// The inversion algorithm is unit-tested in @kolu/solid-browser with a
// synthetic codec. This guards the kolu binding: kolu's REAL preview-URL codec
// (`encodePreviewPath`, the same encoder the server's `buildIframePreviewUrl`
// uses) must round-trip through `pathFromPreviewPathname`. If the encoding
// scheme ever changes, the inversion must still invert it — this fails at the
// unit layer instead of only at e2e. Building inputs via `encodePreviewPath`
// (not hand-written encoded strings) pins the test to the real encoder.
const codec = { encode: encodePreviewPath, decode: decodePreviewPath };
const PREFIX = "/api/terminals/t-1/file";
const navigate = (from: string, to: string): string | null =>
  pathFromPreviewPathname(
    `${PREFIX}/${encodePreviewPath(to)}`,
    `${PREFIX}/${encodePreviewPath(from)}?v=1`,
    from,
    codec,
  );

describe("kolu preview-path codec ⇄ pathFromPreviewPathname", () => {
  it.each([
    { from: "first.html", to: "second.html" },
    { from: "docs/a.html", to: "docs/b.html" },
    { from: "docs/a.html", to: "other.html" },
    { from: "a.html", to: "deep/nested/dir/b.html" },
    { from: "my notes/page one.html", to: "my notes/page two.html" },
    { from: "weird & name.html", to: "100%/=done?.html" },
    { from: "café/résumé.html", to: "naïve/façade.html" },
  ])("round-trips $from → $to", ({ from, to }) => {
    expect(navigate(from, to)).toBe(to);
  });

  it("returns null when the iframe navigated outside the preview route", () => {
    expect(
      pathFromPreviewPathname(
        "/some/other/place.html",
        `${PREFIX}/${encodePreviewPath("first.html")}?v=1`,
        "first.html",
        codec,
      ),
    ).toBeNull();
  });
});
