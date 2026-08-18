import { describe, expect, it } from "vitest";
import { createEngine } from "./index.ts";

describe("official render-state on the shipped engine", () => {
  it("writes VT then reads phrase, SGR color, and dirty from render state", () => {
    const eng = createEngine({ cols: 40, rows: 8 });
    try {
      eng.write("Hello, World!\r\n");
      eng.write("\x1b[1;32mGreen\x1b[0m text\r\n");
      const dirty = eng.updateRenderState();
      expect(dirty === "partial" || dirty === "full").toBe(true);
      const frame = eng.readRenderFrame();
      const texts = frame.cells.map((c) => c.text).join("");
      expect(texts).toContain("Hello, World!");
      expect(texts).toContain("Green");
      const green = frame.cells.find((c) => c.text.includes("G") && c.fg);
      expect(green?.fg).not.toBeNull();
      expect(green?.fg?.g ?? 0).toBeGreaterThan(green?.fg?.r ?? 255);
      expect(green?.fg?.g ?? 0).toBeGreaterThan(green?.fg?.b ?? 255);
      eng.cleanRenderState();
      const again = eng.updateRenderState();
      expect(again).not.toBe("full");
    } finally {
      eng.free();
    }
  });
});
