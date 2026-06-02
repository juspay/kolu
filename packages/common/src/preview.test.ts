import { describe, expect, it } from "vitest";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  decodePreviewPath,
  encodePreviewPath,
  isBinaryPreviewable,
  isMarkdown,
  isRasterImage,
  MARKDOWN_EXTENSIONS,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
} from "./preview.ts";

describe("isBinaryPreviewable", () => {
  it("classifies sandbox documents and raster images (regression: images were UTF-8 garbage)", () => {
    expect(isBinaryPreviewable("out.html")).toBe(true);
    expect(isBinaryPreviewable("logo.svg")).toBe(true);
    expect(isBinaryPreviewable("doc.pdf")).toBe(true);
    expect(isBinaryPreviewable("icon-512.png")).toBe(true);
    expect(isBinaryPreviewable("photo.JPG")).toBe(true);
    expect(isBinaryPreviewable("favicon.ico")).toBe(true);
  });

  it("leaves source files on the text path", () => {
    expect(isBinaryPreviewable("main.ts")).toBe(false);
    expect(isBinaryPreviewable("README.md")).toBe(false);
  });
});

describe("isRasterImage", () => {
  it("matches raster extensions case-insensitively", () => {
    expect(isRasterImage("icon-512.png")).toBe(true);
    expect(isRasterImage("a/b/photo.JPEG")).toBe(true);
    expect(isRasterImage("anim.gif")).toBe(true);
    expect(isRasterImage("hero.webp")).toBe(true);
  });

  it("excludes sandbox documents — SVG can carry scripts and stays in the iframe", () => {
    expect(isRasterImage("logo.svg")).toBe(false);
    expect(isRasterImage("out.html")).toBe(false);
    expect(isRasterImage("doc.pdf")).toBe(false);
  });
});

describe("isMarkdown", () => {
  it("matches markdown extensions case-insensitively", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("docs/Guide.MD")).toBe(true);
    expect(isMarkdown("notes.markdown")).toBe(true);
  });

  it("excludes non-markdown text and binary-previewable files", () => {
    expect(isMarkdown("main.ts")).toBe(false);
    expect(isMarkdown("out.html")).toBe(false);
    expect(isMarkdown("logo.svg")).toBe(false);
  });
});

describe("the binary-previewable partition is structural", () => {
  it("is exactly sandbox ∪ raster", () => {
    expect([...BINARY_PREVIEWABLE_EXTENSIONS].sort()).toEqual(
      [...SANDBOX_PREVIEWABLE_EXTENSIONS, ...RASTER_IMAGE_EXTENSIONS].sort(),
    );
  });

  it("has disjoint sandbox and raster sets (no extension is both)", () => {
    const sandbox = new Set<string>(SANDBOX_PREVIEWABLE_EXTENSIONS);
    const overlap = RASTER_IMAGE_EXTENSIONS.filter((e) => sandbox.has(e));
    expect(overlap).toEqual([]);
  });

  it("every binary-previewable extension is either raster or sandbox — no silent third category", () => {
    // Guards the client's `isRasterImage`-else-iframe branch: a future
    // non-image, non-document binary (`.wasm`, a font) cannot slip in
    // without landing in one of the two sets.
    const sandbox: readonly string[] = SANDBOX_PREVIEWABLE_EXTENSIONS;
    for (const ext of BINARY_PREVIEWABLE_EXTENSIONS) {
      expect(isRasterImage(`file${ext}`) || sandbox.includes(ext)).toBe(true);
    }
  });

  it("markdown is its own axis — never binary-previewable (stays kind:text)", () => {
    // Markdown renders client-side from `content`, so it must never be
    // routed to the binary URL path; it's a text file with a rendered form.
    for (const ext of MARKDOWN_EXTENSIONS) {
      expect(isBinaryPreviewable(`file${ext}`)).toBe(false);
      expect(isMarkdown(`file${ext}`)).toBe(true);
    }
  });
});

describe("encodePreviewPath / decodePreviewPath", () => {
  it("keeps slashes literal and percent-encodes each segment", () => {
    expect(encodePreviewPath("docs/a.html")).toBe("docs/a.html");
    expect(encodePreviewPath("my notes/page one.html")).toBe(
      "my%20notes/page%20one.html",
    );
    expect(encodePreviewPath("100%/=done?.html")).toBe(
      "100%25/%3Ddone%3F.html",
    );
  });

  it("round-trips any repo path (decode ∘ encode = id)", () => {
    for (const p of [
      "first.html",
      "docs/nested/dir/b.html",
      "weird & name.html",
      "café/résumé.html",
      "100%/=done?.html",
    ]) {
      expect(decodePreviewPath(encodePreviewPath(p))).toBe(p);
    }
  });
});
