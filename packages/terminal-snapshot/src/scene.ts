/** A terminal screen laid out as flat, backend-free drawing instructions.
 *
 *  This module answers "what goes where, in what colour" exactly once. Two
 *  backends then execute the answer without re-deciding any of it: the
 *  browser paints a {@link SnapshotScene} onto a 2D canvas (kolu's
 *  copy-screenshot-to-clipboard action), and the daemon emits the same scene
 *  as SVG and rasterises it (the `screen_image` MCP tool and `kolu
 *  screenshot`). That is the whole reason this IR exists: "the browser's
 *  screenshot and the agent's screenshot look the same" is true BY
 *  CONSTRUCTION — one layout, one palette resolution, one set of chrome
 *  geometry — rather than by two code paths being kept in agreement by
 *  prose.
 *
 *  Everything here is pure and browser-safe: no canvas, no DOM, no fs, no
 *  fonts. The one thing a scene deliberately does NOT carry is glyph
 *  metrics — `cellW`/`cellH` are an INPUT, because only the backend can
 *  measure its own font (the browser via `measureText`, the daemon from the
 *  font file's advance width). */

import type { ITheme } from "terminal-themes";
import { parseColor, type RGB } from "terminal-themes/color";
import { type CellColor, gridRows, type SnapshotGrid } from "./cell.ts";

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
} as const;

/** macOS-style traffic lights. Decoration only — they are drawn, never
 *  wired to anything. */
const DOT_COLORS = ["#ff5f57", "#febc2e", "#28c840"] as const;

/** Standard xterm 256-colour palette geometry: indices 16-231 form a 6x6x6
 *  RGB cube, 232-255 a 24-step greyscale ramp. */
const CUBE_STEPS: readonly [number, number, number, number, number, number] = [
  0, 95, 135, 175, 215, 255,
];

/** Indexed read into the 6-step palette. The tuple-index cast asserts that
 *  `% 6` produced a valid index — same blast radius as a runtime check, and
 *  visible to the type checker at the read site. */
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

/** A theme with every colour a cell can reference resolved to a concrete
 *  string — the defaults are xterm.js's own, so an under-specified theme
 *  renders the way the live terminal renders it rather than failing. */
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

function paletteColor(idx: number, t: ResolvedTheme): string {
  if (idx < 16) return t.ansi[idx] ?? t.fg;
  if (idx < 232) return cubeColor(idx);
  return greyColor(idx);
}

/** Resolve one VT colour against the theme. `fallback` is what "default"
 *  means in this position — the theme's foreground for a cell's fg, its
 *  background for a cell's bg. */
function resolveColor(
  color: CellColor,
  t: ResolvedTheme,
  fallback: string,
): string {
  switch (color.kind) {
    case "rgb":
      return rgbColor(color.value);
    case "palette":
      return paletteColor(color.index, t);
    case "default":
      return fallback;
  }
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Mix two colours in sRGB — used for the chrome tints derived from the
 *  theme, so the window border and title bar belong to whatever palette the
 *  terminal is wearing. An unparseable colour mixes as black, which is the
 *  same visual answer a missing colour would give. */
function mix(a: string, b: string, ratio: number): string {
  const pa = parseColor(a).unwrapOr(BLACK);
  const pb = parseColor(b).unwrapOr(BLACK);
  const at = (k: keyof RGB) => Math.round(pa[k] * (1 - ratio) + pb[k] * ratio);
  return `rgb(${at("r")},${at("g")},${at("b")})`;
}

/** A filled rectangle in scene (window) coordinates. */
export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}

/** One cell's glyphs, positioned at its own top-left corner in scene
 *  coordinates.
 *
 *  Deliberately PER CELL rather than per run of same-styled text. A terminal
 *  is a grid: every cell owns a fixed box, and a run drawn as one string
 *  would let the font's own shaping decide the advances — which for kolu's
 *  default (FiraCode, a ligature font) visibly slides `!=` and `=>` off the
 *  grid. One positioned draw per cell is what makes the picture a grid
 *  again, in both backends. */
export interface SceneGlyph {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fill: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** A piece of title-bar text, positioned and sized by the scene.
 *
 *  Here rather than in each backend because it is exactly the kind of small
 *  geometric decision that looks too trivial to share and then silently
 *  diverges: the brand's right margin lived as a bare `14` in the SVG writer
 *  while the canvas painter read `CHROME.brandRightMargin`, and nothing would
 *  have caught the two drifting apart.
 *
 *  `y` is the text's optical centre — both backends centre on it (canvas
 *  `textBaseline: "middle"`, SVG `dominant-baseline: "central"`), so neither
 *  applies a nudge of its own. */
export interface SceneText {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly text: string;
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
  readonly font: {
    readonly family: string;
    readonly size: number;
    readonly cellW: number;
    readonly cellH: number;
  };
  readonly window: { readonly bg: string; readonly border: string };
  readonly titleBar: {
    readonly height: number;
    readonly bg: string;
    readonly fg: string;
    /** The terminal's caption, centred in the bar. */
    readonly title: SceneText;
    /** The kolu wordmark, right-aligned. The browser draws its logo just left
     *  of this — the one piece of the title bar a scene cannot carry, because
     *  a decoded raster is not a value. */
    readonly brand: SceneText;
    readonly dots: readonly SceneDot[];
  };
  /** The terminal grid's own box within the window. */
  readonly term: SceneRect;
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
  readonly fontFamily: string;
  readonly fontSize: number;
  /** Advance width of one cell, measured by the backend against the font it
   *  will actually draw with. */
  readonly cellW: number;
  /** Row height. Backends pass the same formula (`ceil(fontSize * 1.2)`);
   *  it is an input rather than a constant so a caller rendering at an
   *  unusual line height stays consistent between the two. */
  readonly cellH: number;
}

/** Lay a grid out into backend-free drawing instructions. Pure. */
export function buildScene(input: SceneInput): SnapshotScene {
  const { grid, label, fontFamily, fontSize, cellW, cellH } = input;
  const theme = resolveTheme(input.theme);

  const rows = gridRows(grid);
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
  // Title-bar text sits a pixel below the true centre: the dots are measured
  // from their own centre, and matching them exactly reads as slightly high.
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
      // ANSI reverse video, applied once, here — so both backends inherit
      // the swap instead of each remembering to do it.
      if (cell.inverse) [fg, bg] = [bg, fg];
      // A cell outside the grid it claims to belong to is an inconsistency
      // in the producer, not a value to paint at a clamped position: it would
      // draw outside the terminal's own box and over the window chrome. Fail
      // loud — a screenshot that silently lost a column is worse than none.
      if (cell.col < 0 || cell.col >= grid.cols) {
        throw new Error(
          `terminal-snapshot: cell at column ${cell.col} is outside the ${grid.cols}-column grid it was read from`,
        );
      }
      const x = termX + cell.col * cellW;
      if (bg !== theme.bg) {
        rects.push({ x, y, w: cellW * cell.width, h: cellH, fill: bg });
      }
      if (cell.chars !== "" && cell.chars !== " ") {
        glyphs.push({
          x,
          y,
          text: cell.chars,
          fill: fg,
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
    font: { family: fontFamily, size: fontSize, cellW, cellH },
    window: { bg: theme.bg, border },
    titleBar: {
      height: CHROME.titleHeight,
      bg: titleBg,
      fg: titleFg,
      title: {
        x: width / 2,
        y: textY,
        size: Math.round(fontSize * 0.95),
        text: label,
        anchor: "middle",
      },
      brand: {
        x: width - CHROME.brandRightMargin,
        y: textY,
        size: Math.round(fontSize * 0.9),
        text: "kolu",
        anchor: "end",
      },
      dots,
    },
    term: { x: termX, y: termY, w: termW, h: termH, fill: theme.bg },
    rects,
    glyphs,
  };
}
