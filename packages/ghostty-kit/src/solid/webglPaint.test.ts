import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { obtainWebgl, parseCssRgb } from "./webglPaint.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

describe("webgl paint path", () => {
  it("throws when the canvas cannot provide WebGL", () => {
    const canvas = {
      getContext: () => ({ fillText() {} }),
    } as unknown as HTMLCanvasElement;
    expect(() => obtainWebgl(canvas)).toThrow(/WebGL is required/);
  });

  it("does not fillText FORMAT_VT styled runs on the tile canvas", () => {
    const src = readFileSync(join(ROOT, "Ghostty.tsx"), "utf8");
    expect(src).toContain("createWebglPainter");
    expect(src).toContain("updateRenderState");
    expect(src).toContain("readRenderFrame");
    expect(src).not.toMatch(/fillText/);
  });

  it("parses theme hex into render-state RGB", () => {
    expect(parseCssRgb("#1a2b3c", { r: 0, g: 0, b: 0 })).toEqual({
      r: 26,
      g: 43,
      b: 60,
    });
  });
});
