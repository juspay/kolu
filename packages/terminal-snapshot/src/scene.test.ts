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
  dim: false,
  underline: false,
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
    brand: "kolu",
    fontFamily: "Test Mono",
    fontSize: 10,
    cellW: 6,
    cellH: 12,
  });

/** A one-cell scene holding exactly these characters. */
const cellSceneOf = (chars: string) => scene(gridOf([[cell({ chars })]]));

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

  it("takes the row count from the lines themselves, so the two cannot disagree", () => {
    // There is no `rows` field to get wrong: an image is exactly as tall as
    // the content it carries.
    const s = scene(gridOf([[cell()], [cell()], [cell()]]));
    expect(s.height).toBe(12 * 3 + CHROME.titleHeight + CHROME.pad * 2);
    expect(s.term.h).toBe(12 * 3);
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
    const svg = sceneToSvg(cellSceneOf('<&>"'));
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&gt;");
    expect(svg).not.toMatch(/>[<&]</);
  });

  it("draws the window outline as a rounded <rect>, the primitive the canvas backend also names", () => {
    // Both backends must round the corner the SAME way. `<rect rx>` and
    // `ctx.roundRect()` are both true elliptical arcs; the hand-built paths
    // these replaced were an `A r,r` circular arc here against a
    // `quadraticCurveTo` parabola there — two different corners from one scene.
    const s = scene(gridOf([[cell()]]));
    const svg = sceneToSvg(s);
    expect(svg).not.toContain("<path");
    // Clip, fill and stroke are the same shape — three rects, one geometry.
    expect(svg.match(new RegExp(`rx="${s.radius}"`, "g"))).toHaveLength(3);
  });

  it("names the font stack ONCE, on the group every glyph inherits from", () => {
    // The family list is 96 characters. Respelling it on every `<text>` made
    // the document ~4x larger for a renderer that reads the same thing either
    // way — `font-family` and `font-size` are inheritable SVG presentation
    // attributes. The per-glyph attributes that are genuinely per-CELL (bold,
    // italic, fill) stay where they are; this pins only the hoist.
    const svg = sceneToSvg(
      scene(gridOf([[cell({ col: 0 }), cell({ col: 1 })]])),
    );
    expect(svg.match(/font-family=/g)).toHaveLength(1);
    expect(svg).toMatch(/<g clip-path="url\(#win\)" font-family=/);
    // The title bar's two texts are sized by the scene, not by the grid, so
    // they keep their own `font-size` — and nothing else does.
    expect(svg.match(/font-size=/g)).toHaveLength(3);
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

describe("what a cell can paint is decided once, in the scene", () => {
  // These live here rather than under `svg` on purpose. The DROP used to be
  // the SVG writer's, so the canvas painter never did it and Chromium drew an
  // unpaired surrogate as U+FFFD and a C1 control as a box — the same scene,
  // two visibly different pictures. Asserting on the SCENE is what pins the
  // fix: whatever a backend does next, it is handed text it can paint.
  //
  // Spelled as an ESCAPE rather than as a raw byte: an invisible control
  // character in the source reads to a reviewer as a case that exercises
  // nothing.
  it("drops a control character no renderer can paint, keeping the text around it", () => {
    const s = cellSceneOf("a\u0001b");
    expect(s.glyphs[0]?.text).toBe("ab");
    // And the document that comes out is parseable, which is the failure this
    // prevents in the SVG backend specifically: XML 1.0 cannot carry a C0
    // control even as an entity.
    const svg = sceneToSvg(s);
    expect(svg).toContain(">ab<");
    expect(svg).not.toContain("\u0001");
  });

  it("drops an UNPAIRED surrogate, which a canvas would otherwise paint as U+FFFD", () => {
    expect(cellSceneOf("a\uD800b").glyphs[0]?.text).toBe("ab");
  });

  it("keeps an astral glyph whole — a surrogate PAIR is a real character", () => {
    const s = cellSceneOf("🚀");
    expect(s.glyphs[0]?.text).toBe("🚀");
    expect(sceneToSvg(s)).toContain("🚀");
  });

  it("emits no glyph for a cell that held nothing paintable at all", () => {
    expect(cellSceneOf("\u0001").glyphs).toHaveLength(0);
  });

  it("cleans the title-bar caption too — it is text a backend draws", () => {
    // The caption comes from a terminal's cwd and git branch, which are
    // strings the filesystem can make as strange as it likes.
    const s = buildScene({
      grid: gridOf([[cell()]]),
      theme: THEME,
      label: "repo\u0001 (main)",
      brand: "kolu\u0001",
      fontFamily: "Test Mono",
      fontSize: 10,
      cellW: 6,
      cellH: 12,
    });
    expect(s.titleBar.title.text).toBe("repo (main)");
    expect(s.titleBar.brand.text).toBe("kolu");
  });
});

describe("a grid that contradicts itself is refused, not approximated", () => {
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

  it("rejects a wide cell that would overrun the right edge into the chrome", () => {
    // The same rule for the cell's FAR edge: a wide leader parked on the last
    // column would paint its second half over the window chrome.
    expect(() => scene(gridOf([[cell({ col: 9, width: 2 })]], 10))).toThrow(
      /overruns the 10-column grid/,
    );
  });

  it("accepts a wide cell that ends exactly on the last column", () => {
    expect(() =>
      scene(gridOf([[cell({ col: 8, width: 2 })]], 10)),
    ).not.toThrow();
  });

  it("rejects a palette index outside xterm's 256-colour table", () => {
    // greyColor would extrapolate index 300 to rgb(688,688,688) — not a colour,
    // in a PNG that otherwise looks fine.
    expect(() =>
      scene(gridOf([[cell({ fg: { kind: "palette", index: 300 } })]])),
    ).toThrow(/outside xterm's 256-colour table/);
  });

  it("still accepts the last legal index", () => {
    const s = scene(gridOf([[cell({ fg: { kind: "palette", index: 255 } })]]));
    expect(s.glyphs[0]?.fill).toBe("rgb(238,238,238)");
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

describe("attributes a terminal uses to mean something", () => {
  it("paints a dim cell toward the background, not at full intensity", () => {
    // An agent TUI's secondary voice — Claude Code's tool-result lines are
    // dim. Rendering them at full strength makes the picture disagree with the
    // screen, which is the one thing this feature must not do.
    const plain = scene(
      gridOf([[cell({ fg: { kind: "palette", index: 1 } })]]),
    );
    const dim = scene(
      gridOf([[cell({ fg: { kind: "palette", index: 1 }, dim: true })]]),
    );
    expect(dim.glyphs[0]?.fill).not.toBe(plain.glyphs[0]?.fill);
    // Halfway between the red and the theme background.
    expect(dim.glyphs[0]?.fill).toBe("rgb(117,67,68)");
  });

  it("draws an underline as a rule under the cell, in the ink colour", () => {
    const s = scene(gridOf([[cell({ underline: true })]]));
    const rule = s.rects.at(-1);
    expect(rule?.h).toBe(1);
    expect(rule?.w).toBe(6);
    expect(rule?.fill).toBe(s.glyphs[0]?.fill);
    // Sits inside the cell, near its bottom.
    expect(rule?.y).toBe(s.term.y + 12 - 2);
  });

  it("keeps an underlined blank — it still shows a rule", () => {
    const s = scene(gridOf([[cell({ chars: " ", underline: true })]]));
    expect(s.rects).toHaveLength(1);
    expect(s.glyphs).toHaveLength(0);
  });

  it("carries the underline into the SVG as a rect, not a font decoration", () => {
    const svg = sceneToSvg(scene(gridOf([[cell({ underline: true })]])));
    expect(svg).not.toContain("text-decoration");
    expect(svg).toContain('height="1"');
  });
});
