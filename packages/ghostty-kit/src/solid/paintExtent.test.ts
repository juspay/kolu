import { describe, expect, it } from "vitest";
import { createEngine } from "../index.ts";
import { lineText } from "../styled.ts";
import { paintExtent, paintStyledLines } from "./paintExtent.ts";

describe("paintExtent", () => {
  it("asks for the viewport when pinned to the live bottom", () => {
    expect(paintExtent(0, 24)).toEqual({ kind: "viewport" });
  });

  it("asks for a tail covering the scrolled window, never the full buffer", () => {
    expect(paintExtent(10, 24)).toEqual({ kind: "tail", lines: 34 });
  });
});

describe("paintStyledLines", () => {
  it("a scrolled tail after ED 2 still contains the last content line", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 40 });
    try {
      for (let i = 0; i < 5; i++) eng.write(`keep-${i}\r\n`);
      eng.visualLineCount();
      eng.write("\x1b[2J\x1b[Hafter-clear\r\n");
      const lines = paintStyledLines(eng, 1, eng.rows);
      expect(lines.map((l) => lineText(l)).join("\n")).toContain("after-clear");
    } finally {
      eng.free();
    }
  });

  it("does not request a full-buffer restyle for an unlocked viewport", () => {
    const eng = createEngine({ cols: 20, rows: 6, scrollback: 200 });
    try {
      for (let i = 0; i < 40; i++) eng.write(`line-${i}\r\n`);
      const seen: unknown[] = [];
      const orig = eng.styledLines.bind(eng);
      eng.styledLines = (extent) => {
        seen.push(extent);
        return orig(extent);
      };
      const lines = paintStyledLines(eng, 0, eng.rows);
      expect(seen).toEqual([{ kind: "viewport" }]);
      expect(lines.length).toBe(eng.rows);
    } finally {
      eng.free();
    }
  });
});
