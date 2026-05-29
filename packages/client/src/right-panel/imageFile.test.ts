import { describe, expect, it } from "vitest";
import { isRasterImage } from "./imageFile";

describe("isRasterImage", () => {
  it("matches raster image extensions case-insensitively", () => {
    expect(isRasterImage("icon-512.png")).toBe(true);
    expect(isRasterImage("photo.JPG")).toBe(true);
    expect(isRasterImage("a/b/photo.jpeg")).toBe(true);
    expect(isRasterImage("anim.gif")).toBe(true);
    expect(isRasterImage("hero.webp")).toBe(true);
    expect(isRasterImage("favicon.ico")).toBe(true);
  });

  it("excludes SVG — it can carry scripts and stays in the iframe sandbox", () => {
    expect(isRasterImage("logo.svg")).toBe(false);
  });

  it("excludes non-image previewables and source files", () => {
    expect(isRasterImage("out.html")).toBe(false);
    expect(isRasterImage("doc.pdf")).toBe(false);
    expect(isRasterImage("main.ts")).toBe(false);
  });
});
