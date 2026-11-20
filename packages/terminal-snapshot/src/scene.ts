import type { ITheme } from "terminal-themes";
import { parseColor, type RGB } from "terminal-themes/color";
import type { CellColor, SnapshotCell, SnapshotGrid } from "./cell.ts";

/** Window chrome geometry, in logical pixels. Shared by both backends so the
 *  daemon's PNG and the browser's PNG frame the terminal identically. */
export const CHROME = {
  /** Padding between the window edge and the terminal grid. */
  pad: 16,
  /** Corner radius of the window. */
  radius: 12,
  /** Height of the title bar. */
  titleHeight: 34,
  dotRadius: 6,
  dotGap: 8,
  dotMarginLeft: 16,
  brandRightMargin: 14,
  /** Title-bar type size. A property of the BAR, not of the terminal's font
   *  size: the bar is a fixed `titleHeight` and the traffic-light dots never
   *  scale. */
  titleSize: 13,
  /** Wordmark type size, one step below the caption. Same reasoning. */
  brandSize: 12,
  /** Width of the window outline's stroke, beside the outline box it is inset
   *  by: the line width and where the line lands are one decision. */
  strokeWidth: 1,
} as const;

const UNDERLINE_INSET = 2;
const UNDERLINE_THICKNESS = 1;

const DOT_COLORS = ["#ff5f57", "#febc2e", "#28c840"] as const;

const UNPAINTABLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]|\p{Surrogate}/gu;

declare const paintableText: unique symbol;

/** Text a backend may draw. Every code point no renderer can paint has been
 *  dropped, so a glyph or a caption carrying this type needs no further
 *  cleaning in either backend. {@link dropUnpaintable} is its only maker. */
export type PaintableText = string & { readonly [paintableText]: true };

function dropUnpaintable(s: string): PaintableText {
  return s.replace(UNPAINTABLE, "") as PaintableText;
}

const CUBE_STEPS: readonly [number, number, number, number, number, number] = [
  0, 95, 135, 175, 215, 255,
];

function cubeStep(idx: number): number {
  return CUBE_STEPS[(idx % 6) as 0 | 1 | 2 | 3 | 4 | 5];
}

function cubeColor(i: number): string {
  const n = i - 16;
  return `rgb(${cubeStep(Math.floor(n / 36))},${cubeStep(Math.floor(n / 6))},${cubeStep(n)})`;
}

function greyColor(i: number): string {
  const v = 8 + (i - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function rgbColor(packed: number): string {
  return `rgb(${(packed >> 16) & 0xff},${(packed >> 8) & 0xff},${packed & 0xff})`;
}

const DESCENDER_HEADROOM = 1.2;

/** Row height for a given type size — the ONE derivation both backends land
 *  on. A caller that really does render at another line height still passes
 *  its own {@link SceneInput.cellH}. */
export const cellHeight = (fontSize: number): number =>
  Math.ceil(fontSize * DESCENDER_HEADROOM);

export interface ResolvedTheme {
  readonly fg: string;
  readonly bg: string;
  readonly ansi: readonly string[];
}

export function resolveTheme(theme: ITheme): ResolvedTheme {
  return {
    fg: theme.foreground ?? "#c1c1c1",
    bg: theme.background ?? "#000000",
    ansi: [
      theme.black ?? "#000000",
      theme.red ?? "#cd0000",
      theme.green ?? "#00cd00",
      theme.yellow ?? "#cdcd00",
      theme.blue ?? "#0000ee",
      theme.magenta ?? "#cd00cd",
      theme.cyan ?? "#00cdcd",
      theme.white ?? "#e5e5e5",
      theme.brightBlack ?? "#7f7f7f",
      theme.brightRed ?? "#ff0000",
      theme.brightGreen ?? "#00ff00",
      theme.brightYellow ?? "#ffff00",
      theme.brightBlue ?? "#5c5cff",
      theme.brightMagenta ?? "#ff00ff",
      theme.brightCyan ?? "#00ffff",
      theme.brightWhite ?? "#ffffff",
    ],
  };
}

declare const paletteIndexBrand: unique symbol;

type PaletteIndex = number & { readonly [paletteIndexBrand]: true };

function paletteIndex(idx: number): PaletteIndex {
  if (idx < 0 || idx > 255) {
    throw new Error(
      `terminal-snapshot: palette index ${idx} is outside xterm's 256-colour table`,
    );
  }
  return idx as PaletteIndex;
}

function paletteColor(idx: PaletteIndex, t: ResolvedTheme): string {
  if (idx < 16) return t.ansi[idx] ?? t.fg;
  if (idx < 232) return cubeColor(idx);
  return greyColor(idx);
}

function resolveColor(
  color: CellColor,
  t: ResolvedTheme,
  fallback: string,
): string {
  switch (color.kind) {
    case "rgb":
      return rgbColor(color.value);
    case "palette":
      return paletteColor(paletteIndex(color.index), t);
    case "default":
      return fallback;
  }
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };

function mix(a: string, b: string, ratio: number): string {
  const pa = parseColor(a).unwrapOr(BLACK);
  const pb = parseColor(b).unwrapOr(BLACK);
  const at = (k: keyof RGB) => Math.round(pa[k] * (1 - ratio) + pb[k] * ratio);
  return `rgb(${at("r")},${at("g")},${at("b")})`;
}

/** A rectangle in scene (window) coordinates. */
export interface SceneBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SceneRect extends SceneBox {
  readonly fill: string;
}

/** One cell's glyphs, positioned at its own top-left corner in scene
 *  coordinates.
 *
 *  PER CELL rather than per run of same-styled text: every cell owns a fixed
 *  box, where a run drawn as one string would let the font's own shaping
 *  decide the advances and slide `!=` and `=>` off the grid. */
export interface SceneGlyph {
  readonly x: number;
  readonly y: number;
  readonly text: PaintableText;
  readonly fill: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** A piece of title-bar text, positioned and sized by the scene.
 *
 *  `y` is the text's optical centre — both backends centre on it (canvas
 *  `textBaseline: "middle"`, SVG `dominant-baseline: "central"`), so neither
 *  applies a nudge of its own. */
export interface SceneText {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly text: PaintableText;
  /** How `x` reads: the text's centre, or its right-hand end. */
  readonly anchor: "middle" | "end";
}

export interface SceneDot {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
}

export interface SnapshotScene {
  /** Logical pixel size of the whole image, chrome included. */
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** The font both backends draw every glyph with. Only the two facts a
   *  backend still needs at DRAW time: the cell advance and the row height are
   *  layout inputs, and every position they produce is already absolute in the
   *  boxes and glyphs below. */
  readonly font: {
    readonly family: PaintableText;
    readonly size: number;
  };
  readonly window: {
    readonly bg: string;
    readonly border: string;
    readonly strokeWidth: number;
    /** The rounded rect the window is filled with, clipped to and stroked
     *  along — already inset by half the stroke, so the line lands ON the
     *  window boundary rather than straddling it. */
    readonly outline: SceneBox;
  };
  readonly titleBar: {
    readonly height: number;
    readonly bg: string;
    readonly fg: string;
    /** The terminal's caption, centred in the bar. */
    readonly title: SceneText;
    /** The caller's wordmark, right-aligned. The browser draws its logo just
     *  left of this — the one piece of the title bar a scene cannot carry,
     *  because a decoded raster is not a value. */
    readonly brand: SceneText;
    readonly dots: readonly SceneDot[];
  };
  /** The terminal grid's own box within the window. Geometry with no fill: the
   *  terminal background IS the window background (one `theme.bg`), already
   *  painted over the whole rounded rect. */
  readonly term: SceneBox;
  /** Cell backgrounds — only those that differ from the terminal background,
   *  so a plain screen emits none. */
  readonly rects: readonly SceneRect[];
  readonly glyphs: readonly SceneGlyph[];
}

export interface SceneInput {
  readonly grid: SnapshotGrid;
  readonly theme: ITheme;
  /** Title-bar label — kolu passes the terminal's name and git branch. */
  readonly label: string;
  /** Wordmark, right-aligned in the title bar. An INPUT for the same reason
   *  {@link label} is: whose product this is, is not a fact about a terminal
   *  grid. */
  readonly brand: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  /** Advance width of one cell, measured by the backend against the font it
   *  will actually draw with. */
  readonly cellW: number;
  /** Row height. Both backends take it from {@link cellHeight}, the one
   *  authority for the derivation; it stays an input so a caller that really
   *  does render at another line height can say so. */
  readonly cellH: number;
}

function assertCellFitsGrid(cell: SnapshotCell, cols: number): void {
  if (cell.col < 0 || cell.col >= cols) {
    throw new Error(
      `terminal-snapshot: cell at column ${cell.col} is outside the ${cols}-column grid it was read from`,
    );
  }
  if (cell.col + cell.width > cols) {
    throw new Error(
      `terminal-snapshot: a width-${cell.width} cell at column ${cell.col} overruns the ${cols}-column grid it was read from`,
    );
  }
}

/** Lay a grid out into backend-free drawing instructions. Pure. */
export function buildScene(input: SceneInput): SnapshotScene {
  const { grid, label, brand, fontFamily, fontSize, cellW, cellH } = input;
  const theme = resolveTheme(input.theme);

  const rows = grid.lines.length;
  const termW = Math.ceil(cellW * grid.cols);
  const termH = cellH * rows;
  const width = termW + CHROME.pad * 2;
  const height = termH + CHROME.titleHeight + CHROME.pad * 2;
  const termX = CHROME.pad;
  const termY = CHROME.titleHeight + CHROME.pad;

  const border = mix(theme.bg, theme.fg, 0.22);
  const titleBg = mix(theme.bg, theme.fg, 0.08);
  const titleFg = mix(theme.bg, theme.fg, 0.7);

  const dotY = CHROME.titleHeight / 2;
  const textY = dotY + 1;
  const dots = DOT_COLORS.map((fill, i) => ({
    cx: CHROME.dotMarginLeft + i * (CHROME.dotRadius * 2 + CHROME.dotGap),
    cy: dotY,
    r: CHROME.dotRadius,
    fill,
  }));

  const rects: SceneRect[] = [];
  const glyphs: SceneGlyph[] = [];
  for (const [row, line] of grid.lines.entries()) {
    const y = termY + row * cellH;
    for (const cell of line.cells) {
      let fg = resolveColor(cell.fg, theme, theme.fg);
      let bg = resolveColor(cell.bg, theme, theme.bg);
      if (cell.inverse) [fg, bg] = [bg, fg];
      assertCellFitsGrid(cell, grid.cols);
      const x = termX + cell.col * cellW;
      if (bg !== theme.bg) {
        rects.push({ x, y, w: cellW * cell.width, h: cellH, fill: bg });
      }
      const ink = cell.dim ? mix(fg, bg, 0.5) : fg;
      if (cell.underline) {
        rects.push({
          x,
          y: y + cellH - UNDERLINE_INSET,
          w: cellW * cell.width,
          h: UNDERLINE_THICKNESS,
          fill: ink,
        });
      }
      const chars = dropUnpaintable(cell.chars);
      if (chars !== "" && chars !== " ") {
        glyphs.push({
          x,
          y,
          text: chars,
          fill: ink,
          bold: cell.bold,
          italic: cell.italic,
        });
      }
    }
  }

  return {
    width,
    height,
    radius: CHROME.radius,
    font: { family: dropUnpaintable(fontFamily), size: fontSize },
    window: {
      bg: theme.bg,
      border,
      strokeWidth: CHROME.strokeWidth,
      outline: {
        x: CHROME.strokeWidth / 2,
        y: CHROME.strokeWidth / 2,
        w: width - CHROME.strokeWidth,
        h: height - CHROME.strokeWidth,
      },
    },
    titleBar: {
      height: CHROME.titleHeight,
      bg: titleBg,
      fg: titleFg,
      title: {
        x: width / 2,
        y: textY,
        size: CHROME.titleSize,
        text: dropUnpaintable(label),
        anchor: "middle",
      },
      brand: {
        x: width - CHROME.brandRightMargin,
        y: textY,
        size: CHROME.brandSize,
        text: dropUnpaintable(brand),
        anchor: "end",
      },
      dots,
    },
    term: { x: termX, y: termY, w: termW, h: termH },
    rects,
    glyphs,
  };
}
