/** Copy a terminal's contents to the clipboard as a polished PNG.
 *
 *  Reads `xterm.buffer.active` directly (scrollback + viewport), paints each
 *  cell onto an offscreen canvas with the theme's colors, and wraps the whole
 *  thing in a rounded-corner window chrome (border + title bar with traffic-
 *  light dots and the terminal's repo/branch label). Writes the PNG blob to
 *  the clipboard.
 *
 *  Renderer-independent by construction — we never touch xterm's live canvas
 *  or DOM. An earlier attempt routed `SerializeAddon.serializeAsHTML` through
 *  `html-to-image`'s SVG `<foreignObject>` pipeline, but Chromium rasterizes
 *  foreignObject-embedded HTML inconsistently (transparent pixels in headless
 *  Chrome, "black image" reports in real Chrome). Painting cells directly
 *  sidesteps that entire surface. */

import { toast } from "solid-sonner";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { FONT_FAMILY } from "terminal-themes";
import { getTerminalRefs } from "./terminal/terminalRefs";
import { terminalName } from "./terminal/terminalDisplay";

/** Standard xterm 256-color palette. First 16 come from the theme; 16-231
 *  form a 6×6×6 RGB cube; 232-255 are grayscale. */
const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

/** Window chrome geometry (logical pixels). */
const PAD = 16;
const RADIUS = 12;
const TITLE_H = 34;
const DOT_R = 6;
const DOT_GAP = 8;
const DOT_MARGIN_LEFT = 16;
const DOT_MACOS = ["#ff5f57", "#febc2e", "#28c840"] as const;

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

/** xterm.js IBufferCell subset we use. Predicate methods are used instead
 *  of raw `getFg/BgColorMode()` comparisons because the mode enum is not
 *  part of the public API and differs between 16- and 256-color cells. */
interface BufferCell {
  getChars: () => string;
  getWidth: () => number;
  getFgColor: () => number;
  getBgColor: () => number;
  isFgRGB: () => boolean;
  isBgRGB: () => boolean;
  isFgPalette: () => boolean;
  isBgPalette: () => boolean;
  isBold: () => number;
  isItalic: () => number;
  isInverse: () => number;
}

function cellColors(
  cell: BufferCell,
  t: ResolvedTheme,
): { fg: string; bg: string } {
  let fg = cell.isFgRGB()
    ? rgbColor(cell.getFgColor())
    : cell.isFgPalette()
      ? paletteColor(cell.getFgColor(), t)
      : t.fg;
  let bg = cell.isBgRGB()
    ? rgbColor(cell.getBgColor())
    : cell.isBgPalette()
      ? paletteColor(cell.getBgColor(), t)
      : t.bg;
  // ANSI inverse — swap fg and bg for the cell.
  if (cell.isInverse()) [fg, bg] = [bg, fg];
  return { fg, bg };
}

/** Compose terminal name + git branch for the title bar. Falls back to
 *  a bare "terminal" label when metadata isn't available. */
function titleLabel(meta: TerminalMetadata | undefined): string {
  if (!meta) return "terminal";
  const name = terminalName(meta);
  return meta.git?.branch ? `${name} (${meta.git.branch})` : name;
}

/** Mix two hex colors in sRGB. Used for subtle chrome tints derived from
 *  the theme — the title-bar background and the window border. */
function mix(a: string, b: string, ratio: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa.r * (1 - ratio) + pb.r * ratio);
  const g = Math.round(pa.g * (1 - ratio) + pb.g * ratio);
  const bl = Math.round(pa.b * (1 - ratio) + pb.b * ratio);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(c: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  if (rgb) {
    return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]! };
  }
  // Unknown color string — return black; the mix result will just be `b`.
  return { r: 0, g: 0, b: 0 };
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function screenshotTerminal(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): Promise<void> {
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

  const termW = Math.ceil(cellW * cols);
  const termH = cellH * rows;
  const logicalW = termW + PAD * 2;
  const logicalH = termH + TITLE_H + PAD * 2;

  // Upscale the backing store by devicePixelRatio so glyphs and chrome
  // render at native resolution on HiDPI displays. All draw commands
  // continue to operate in logical (CSS) pixels after ctx.scale.
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(logicalW * dpr);
  canvas.height = Math.ceil(logicalH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast.error("Canvas unavailable");
    return;
  }
  ctx.scale(dpr, dpr);

  // Window shell — rounded bg, thin border, title bar.
  const borderColor = mix(theme.bg, theme.fg, 0.22);
  const titleBarBg = mix(theme.bg, theme.fg, 0.08);
  const titleTextColor = mix(theme.bg, theme.fg, 0.7);

  roundedRectPath(ctx, 0.5, 0.5, logicalW - 1, logicalH - 1, RADIUS);
  ctx.fillStyle = theme.bg;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  // Title bar: fill a rounded top strip.
  ctx.save();
  roundedRectPath(ctx, 0.5, 0.5, logicalW - 1, logicalH - 1, RADIUS);
  ctx.clip();
  ctx.fillStyle = titleBarBg;
  ctx.fillRect(0, 0, logicalW, TITLE_H);
  ctx.fillStyle = borderColor;
  ctx.fillRect(0, TITLE_H, logicalW, 1);
  ctx.restore();

  // Traffic-light dots.
  const dotY = TITLE_H / 2;
  for (let i = 0; i < DOT_MACOS.length; i++) {
    ctx.beginPath();
    ctx.arc(
      DOT_MARGIN_LEFT + i * (DOT_R * 2 + DOT_GAP),
      dotY,
      DOT_R,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = DOT_MACOS[i]!;
    ctx.fill();
  }

  // Title text — centered, truncated to the available width.
  ctx.font = `${Math.round(fontSize * 0.95)}px ${fontFamily}`;
  ctx.fillStyle = titleTextColor;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const label = titleLabel(meta);
  ctx.fillText(label, logicalW / 2, dotY + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  // Terminal content.
  const termX = PAD;
  const termY = TITLE_H + PAD;
  ctx.save();
  ctx.translate(termX, termY);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, termW, termH);

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
  ctx.restore();

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
