import { describe, expect, it } from "vitest";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  isBinaryPreviewable,
  isRasterImage,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
} from "./previewable.ts";

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
});
