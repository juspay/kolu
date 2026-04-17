/** Copy a terminal's contents to the clipboard as a PNG.
 *
 *  Reads xterm's buffer directly (scrollback + viewport), paints each cell
 *  onto an offscreen canvas with the theme's colors, and writes the PNG blob
 *  to the clipboard.
 *
 *  Renderer-independent by construction — we never touch xterm's live canvas
 *  or DOM. An earlier attempt routed `SerializeAddon.serializeAsHTML` through
 *  `html-to-image`'s SVG `<foreignObject>` pipeline, but Chromium rasterizes
 *  foreignObject-embedded HTML inconsistently (transparent pixels in headless
 *  Chrome, "black image" reports in real Chrome). Painting cells directly
 *  sidesteps that entire surface. */

import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { FONT_FAMILY } from "terminal-themes";
import { getTerminalRefs } from "./terminal/terminalRefs";

/** xterm's color model: any other mode (0 = default) uses the theme's
 *  fg/bg; 1 = ANSI palette (0-255); 2 = 24-bit RGB packed into a single int. */
const COLOR_MODE_PALETTE = 1;
const COLOR_MODE_RGB = 2;

/** Standard xterm 256-color palette. First 16 come from the theme; 16-231
 *  form a 6×6×6 RGB cube; 232-255 are grayscale. */
const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function cubeColor(i: number): string {
  const n = i - 16;
  const r = CUBE_STEPS[Math.floor(n / 36) % 6]!;
  const g = CUBE_STEPS[Math.floor(n / 6) % 6]!;
  const b = CUBE_STEPS[n % 6]!;
  return `rgb(${r},${g},${b})`;
}

function grayColor(i: number): string {
  const v = 8 + (i - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

interface ResolvedTheme {
  fg: string;
  bg: string;
  ansi: string[];
}

function resolveTheme(
  theme: Record<string, string | undefined>,
): ResolvedTheme {
  const fg = theme.foreground ?? "#c1c1c1";
  const bg = theme.background ?? "#000000";
  const ansi = [
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
  ];
  return { fg, bg, ansi };
}

function paletteColor(idx: number, t: ResolvedTheme): string {
  if (idx < 16) return t.ansi[idx] ?? t.fg;
  if (idx < 232) return cubeColor(idx);
  return grayColor(idx);
}

function rgbColor(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `rgb(${r},${g},${b})`;
}

/** xterm.js IBufferCell subset we use. */
interface BufferCell {
  getChars: () => string;
  getWidth: () => number;
  getFgColor: () => number;
  getFgColorMode: () => number;
  getBgColor: () => number;
  getBgColorMode: () => number;
  isBold: () => number;
  isItalic: () => number;
  isInverse: () => number;
}

function cellColors(
  cell: BufferCell,
  t: ResolvedTheme,
): { fg: string; bg: string } {
  const fgMode = cell.getFgColorMode();
  const bgMode = cell.getBgColorMode();
  let fg =
    fgMode === COLOR_MODE_PALETTE
      ? paletteColor(cell.getFgColor(), t)
      : fgMode === COLOR_MODE_RGB
        ? rgbColor(cell.getFgColor())
        : t.fg;
  let bg =
    bgMode === COLOR_MODE_PALETTE
      ? paletteColor(cell.getBgColor(), t)
      : bgMode === COLOR_MODE_RGB
        ? rgbColor(cell.getBgColor())
        : t.bg;
  // ANSI inverse — swap fg and bg for the cell.
  if (cell.isInverse()) [fg, bg] = [bg, fg];
  return { fg, bg };
}

export async function screenshotTerminal(id: TerminalId): Promise<void> {
  const refs = getTerminalRefs(id);
  if (!refs) {
    toast.error("Terminal not ready");
    return;
  }
  const xterm = refs.xterm as unknown as {
    cols: number;
    options: {
      fontSize?: number;
      fontFamily?: string;
      theme?: Record<string, string | undefined>;
    };
    buffer: {
      active: {
        length: number;
        getLine: (
          y: number,
        ) =>
          | { getCell: (x: number, dst?: BufferCell) => BufferCell | undefined }
          | undefined;
        getNullCell: () => BufferCell;
      };
    };
  };

  const theme = resolveTheme(xterm.options.theme ?? {});
  const fontSize = xterm.options.fontSize ?? 14;
  const fontFamily = xterm.options.fontFamily ?? FONT_FAMILY;
  // Wait for webfonts — on the first screenshot after a cold page load,
  // @font-face declarations may not have finished loading. fillText would
  // silently fall back to the browser's default glyphs and produce an
  // image that visually mismatches the live terminal.
  if (document.fonts?.ready) await document.fonts.ready;
  const buffer = xterm.buffer.active;
  const cols = xterm.cols;
  const rows = buffer.length;

  // Measure a cell using a probe canvas. A fresh 2d context inherits the
  // browser's default font; we set it explicitly before measuring.
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) {
    toast.error("Canvas unavailable");
    return;
  }
  probe.font = `${fontSize}px ${fontFamily}`;
  const cellW = Math.max(1, probe.measureText("M").width);
  // xterm's default lineHeight is 1.0; we add a small padding so descenders
  // (g, y) don't get clipped by the next row's background.
  const cellH = Math.ceil(fontSize * 1.2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cellW * cols);
  canvas.height = cellH * rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast.error("Canvas unavailable");
    return;
  }

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "alphabetic";

  const tempCell = buffer.getNullCell();
  for (let y = 0; y < rows; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    for (let x = 0; x < cols; x++) {
      const cell = line.getCell(x, tempCell);
      if (!cell) continue;
      const chars = cell.getChars();
      const width = cell.getWidth();
      // width=0 → continuation of a wide char (already painted); skip.
      if (width === 0) continue;
      const { fg, bg } = cellColors(cell, theme);
      const px = x * cellW;
      const py = y * cellH;
      const w = cellW * width;
      if (bg !== theme.bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(px, py, w, cellH);
      }
      if (chars) {
        const bold = cell.isBold() ? "bold " : "";
        const italic = cell.isItalic() ? "italic " : "";
        ctx.font = `${italic}${bold}${fontSize}px ${fontFamily}`;
        ctx.fillStyle = fg;
        ctx.fillText(chars, px, py + fontSize);
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    toast.error("Screenshot failed");
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Screenshot copied");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(`Screenshot failed: ${msg}`);
  }
}
