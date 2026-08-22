/** The layout decisions both backends inherit. Pinned here because a drift in
 *  any of them silently changes BOTH the browser's screenshot and the daemon's
 *  — the whole point of there being one scene builder. */

import { describe, expect, it } from "vitest";
import type { SnapshotCell, SnapshotGrid } from "./cell.ts";
import { buildScene, CHROME, resolveTheme } from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

const THEME = {
  foreground: "#c5c8c6",
  background: "#1d1f21",
  red: "#cc6666",
  blue: "#81a2be",
};

const cell = (over: Partial<SnapshotCell> = {}): SnapshotCell => ({
  col: 0,
  chars: "x",
  width: 1,
  fg: { kind: "default" },
  bg: { kind: "default" },
  bold: false,
  italic: false,
  inverse: false,
  ...over,
});

const gridOf = (cells: SnapshotCell[][], cols = 10): SnapshotGrid => ({
  cols,
  lines: cells.map((c) => ({ cells: c })),
});

const scene = (grid: SnapshotGrid) =>
  buildScene({
    grid,
    theme: THEME,
    label: "repo (main)",
    fontFamily: "Test Mono",
    fontSize: 10,
    cellW: 6,
    cellH: 12,
  });

describe("theme resolution", () => {
  it("fills every unset colour from xterm's own defaults rather than leaving a hole", () => {
    const t = resolveTheme({});
    expect(t.fg).toBe("#c1c1c1");
    expect(t.bg).toBe("#000000");
    expect(t.ansi).toHaveLength(16);
    expect(t.ansi.every((c) => c.startsWith("#"))).toBe(true);
  });

  it("prefers the theme's own colours where it has them", () => {
    const t = resolveTheme(THEME);
    expect(t.fg).toBe("#c5c8c6");
    expect(t.ansi[1]).toBe("#cc6666");
  });
});

describe("cell colours", () => {
  it("resolves a palette index below 16 through the theme's ANSI slots", () => {
    const s = scene(gridOf([[cell({ fg: { kind: "palette", index: 1 } })]]));
    expect(s.glyphs[0]?.fill).toBe("#cc6666");
  });

  it("computes the 6x6x6 cube for indices 16-231 without consulting the theme", () => {
    // 196 = pure red at the cube's corner: r=5 (255), g=0, b=0.
    const s = scene(gridOf([[cell({ fg: { kind: "palette", index: 196 } })]]));
    expect(s.glyphs[0]?.fill).toBe("rgb(255,0,0)");
  });

  it("computes the greyscale ramp for indices 232-255", () => {
    const s = scene(gridOf([[cell({ fg: { kind: "palette", index: 232 } })]]));
    expect(s.glyphs[0]?.fill).toBe("rgb(8,8,8)");
  });

  it("unpacks a 24-bit truecolour value", () => {
    const s = scene(gridOf([[cell({ fg: { kind: "rgb", value: 0x78c8ff } })]]));
    expect(s.glyphs[0]?.fill).toBe("rgb(120,200,255)");
  });

  it("swaps foreground and background for an inverse cell, once, in the scene", () => {
    const s = scene(gridOf([[cell({ inverse: true })]]));
    // fg becomes the theme background, and the cell now paints a background
    // (the theme foreground) where a default cell painted none.
    expect(s.glyphs[0]?.fill).toBe("#1d1f21");
    expect(s.rects[0]?.fill).toBe("#c5c8c6");
  });
});

describe("layout", () => {
  it("sizes the image from the grid plus the shared chrome", () => {
    const s = scene(gridOf([[cell()], [cell()]], 10));
    expect(s.width).toBe(6 * 10 + CHROME.pad * 2);
    expect(s.height).toBe(12 * 2 + CHROME.titleHeight + CHROME.pad * 2);
    expect(s.term.x).toBe(CHROME.pad);
    expect(s.term.y).toBe(CHROME.titleHeight + CHROME.pad);
  });

  it("places a cell at its own column and row, in absolute coordinates", () => {
    const s = scene(gridOf([[], [cell({ col: 3 })]]));
    expect(s.glyphs[0]?.x).toBe(CHROME.pad + 3 * 6);
    expect(s.glyphs[0]?.y).toBe(CHROME.titleHeight + CHROME.pad + 12);
  });

  it("gives a wide cell a background two columns across", () => {
    const s = scene(
      gridOf([[cell({ width: 2, bg: { kind: "palette", index: 4 } })]]),
    );
    expect(s.rects[0]?.w).toBe(12);
  });

  it("emits no background rect for a cell already on the terminal background", () => {
    expect(scene(gridOf([[cell()]])).rects).toHaveLength(0);
  });

  it("emits no glyph for a blank cell that only carries a background", () => {
    const s = scene(
      gridOf([[cell({ chars: " ", bg: { kind: "palette", index: 4 } })]]),
    );
    expect(s.glyphs).toHaveLength(0);
    expect(s.rects).toHaveLength(1);
  });
});

describe("svg", () => {
  it("emits one text element per cell, so the font cannot ligature across the grid", () => {
    const svg = sceneToSvg(
      scene(
        gridOf([[cell({ col: 0, chars: "!" }), cell({ col: 1, chars: "=" })]]),
      ),
    );
    // The two cells are separate elements even though they are adjacent and
    // identically styled — `!=` must never become one FiraCode ligature.
    expect(svg.match(/>!</g)).toHaveLength(1);
    expect(svg.match(/>=</g)).toHaveLength(1);
  });

  it("escapes XML metacharacters a shell prompt really produces", () => {
    const svg = sceneToSvg(gridSvgOf('<&>"'));
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&gt;");
    expect(svg).not.toMatch(/>[<&]</);
  });

  it("drops control characters XML cannot carry rather than emitting a broken document", () => {
    // A stray \x01 in the scrollback must not make every screenshot of that
    // terminal unparseable.
    const svg = sceneToSvg(gridSvgOf("ab"));
    expect(svg).toContain(">ab<");
  });

  it("keeps an astral glyph whole — a surrogate PAIR is legal XML", () => {
    const svg = sceneToSvg(gridSvgOf("🚀"));
    expect(svg).toContain("🚀");
  });

  it("carries bold and italic through as font attributes", () => {
    const svg = sceneToSvg(
      scene(gridOf([[cell({ bold: true, italic: true })]])),
    );
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('font-style="italic"');
  });

  it("is a single well-formed root element", () => {
    const svg = sceneToSvg(scene(gridOf([[cell()]])));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

function gridSvgOf(chars: string) {
  return scene(gridOf([[cell({ chars })]]));
}

describe("a grid that contradicts itself is refused, not painted", () => {
  it("rejects a cell outside the column count it was read from", () => {
    // Reachable only from a producer bug or a peer that lied on the wire, and
    // the honest answer is neither to clamp it (a column silently in the wrong
    // place) nor to drop it (a column silently missing) — it is to fail.
    expect(() => scene(gridOf([[cell({ col: 12 })]], 10))).toThrow(
      /outside the 10-column grid/,
    );
  });

  it("rejects a negative column", () => {
    expect(() => scene(gridOf([[cell({ col: -1 })]], 10))).toThrow(
      /outside the 10-column grid/,
    );
  });

  it("takes the row count from the lines themselves, so the two cannot disagree", () => {
    // There is no `rows` field to get wrong: an image is exactly as tall as
    // the content it carries.
    const s = scene(gridOf([[cell()], [cell()], [cell()]]));
    expect(s.height).toBe(12 * 3 + CHROME.titleHeight + CHROME.pad * 2);
    expect(s.term.h).toBe(12 * 3);
  });
});

describe("title-bar geometry is the scene's, not a backend's", () => {
  it("right-aligns the wordmark at the shared margin", () => {
    const s = scene(gridOf([[cell()]]));
    expect(s.titleBar.brand.x).toBe(s.width - CHROME.brandRightMargin);
    expect(s.titleBar.brand.anchor).toBe("end");
  });

  it("centres the title, and puts both texts on one baseline", () => {
    const s = scene(gridOf([[cell()]]));
    expect(s.titleBar.title.x).toBe(s.width / 2);
    expect(s.titleBar.title.anchor).toBe("middle");
    expect(s.titleBar.title.y).toBe(s.titleBar.brand.y);
  });

  it("puts the scene's own numbers in the SVG — no literal margin of its own", () => {
    const s = scene(gridOf([[cell()]]));
    const svg = sceneToSvg(s);
    expect(svg).toContain(`x="${s.titleBar.brand.x}"`);
    expect(svg).toContain('text-anchor="end"');
  });
});
