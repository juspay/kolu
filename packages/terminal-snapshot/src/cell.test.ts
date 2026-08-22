/** `readGrid` against a real xterm buffer — the one thing a hand-built stub
 *  cannot check, because what is under test is how xterm actually lays a wide
 *  glyph across two columns. */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readGrid } from "./cell.ts";
import { buildScene } from "./scene.ts";

// @xterm packages ship CJS only.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

const write = (term: InstanceType<typeof Terminal>, s: string) =>
  new Promise<void>((resolve) => term.write(s, resolve));

describe("readGrid", () => {
  it("reads the LEFTMOST columns when asked for fewer than the buffer has", async () => {
    // The narrowed read kaval does to hold a wide terminal inside its area
    // cap. Leftmost, because that is where a prompt and a TUI's structure are.
    const term = new Terminal({ cols: 20, rows: 1, allowProposedApi: true });
    await write(term, "abcdefgh");
    const grid = readGrid(term.buffer.active, 4, 0, 1);
    expect(grid.cols).toBe(4);
    expect(grid.lines[0]?.cells.map((c) => c.chars).join("")).toBe("abcd");
    term.dispose();
  });

  it("drops a wide glyph the slice would cut in half", async () => {
    // `日` occupies columns 0-1 and `本` columns 2-3, so a 3-column slice ends
    // mid-glyph. Half a glyph is not a glyph: its leader would claim a column
    // outside the grid it ships in, which paints over the window chrome — and
    // `buildScene` refuses such a cell outright, failing the whole screenshot.
    const term = new Terminal({ cols: 20, rows: 1, allowProposedApi: true });
    await write(term, "日本語");
    const grid = readGrid(term.buffer.active, 3, 0, 1);
    expect(grid.lines[0]?.cells.map((c) => c.chars)).toEqual(["日"]);
    expect(() =>
      buildScene({
        grid,
        theme: { foreground: "#fff", background: "#000" },
        label: "t",
        brand: "kolu",
        fontFamily: "mono",
        fontSize: 15,
        cellW: 9,
        cellH: 18,
      }),
    ).not.toThrow();
    term.dispose();
  });
});
