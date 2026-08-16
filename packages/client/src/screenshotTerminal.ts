/** Copy the active terminal viewport to the clipboard as a polished PNG.
 *
 *  Reads the currently-visible slice of `xterm.buffer.active` — `xterm.rows`
 *  lines starting at `buffer.viewportY` — and paints each cell onto an
 *  offscreen canvas with the theme's colors, then wraps the whole thing in a
 *  rounded-corner window chrome (border + title bar with traffic-light dots
 *  and the terminal's repo/branch label). Writes the PNG blob to the
 *  clipboard. Scrollback above the viewport is not captured; if the user has
 *  scrolled up, the capture is WYSIWYG with what they're looking at.
 *
 *  Renderer-independent by construction — we never touch xterm's live canvas
 *  or DOM. An earlier attempt routed `SerializeAddon.serializeAsHTML` through
 *  `html-to-image`'s SVG `<foreignObject>` pipeline, but Chromium rasterizes
 *  foreignObject-embedded HTML inconsistently (transparent pixels in headless
 *  Chrome, "black image" reports in real Chrome). Painting cells directly
 *  sidesteps that entire surface. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { terminalKey } from "kolu-common/terminalKey";
import { toast } from "solid-sonner";
import { FONT_FAMILY } from "terminal-themes";
import { parseColor, type RGB } from "terminal-themes/color";
import type { UiAction } from "./runAction";
import { getTerminalRefs } from "./terminal/terminalRefs";

/** Window chrome geometry (logical pixels). */
const PAD = 16;
const RADIUS = 12;
const TITLE_H = 34;
const DOT_R = 6;
const DOT_GAP = 8;
const DOT_MARGIN_LEFT = 16;
const DOT_MACOS = ["#ff5f57", "#febc2e", "#28c840"] as const;
const BRAND_RIGHT_MARGIN = 14;
const BRAND_LOGO_URL = new URL("../favicon.svg", import.meta.url).href;
/** One decode of the brand logo, memoized by its RESULT.
 *
 *  `Effect.callback` over the image's `load`/`error` pair — the resume is
 *  idempotent, so the two listeners cannot double-settle. The memo caches the
 *  decoded image rather than the promise the old shape held, which means a
 *  FAILED decode is not remembered forever: a transient load failure no longer
 *  strips the logo from every screenshot for the rest of the session. */
let brandLogo: HTMLImageElement | undefined;
const loadBrandLogo: Effect.Effect<HTMLImageElement, Error> = Effect.suspend(
  () =>
    brandLogo !== undefined
      ? Effect.succeed(brandLogo)
      : Effect.callback<HTMLImageElement, Error>((resume) => {
          const image = new Image();
          image.decoding = "async";
          image.onload = () => resume(Effect.succeed(image));
          image.onerror = () =>
            resume(
              Effect.fail(
                new Error(`Kolu logo failed to load: ${BRAND_LOGO_URL}`),
              ),
            );
          image.src = BRAND_LOGO_URL;
        }).pipe(
          Effect.tap((image) =>
            Effect.sync(() => {
              brandLogo = image;
            }),
          ),
        ),
);

interface ResolvedTheme {
  fg: string;
  bg: string;
}

function resolveTheme(
  theme: Record<string, string | undefined>,
): ResolvedTheme {
  return {
    fg: theme.foreground ?? "#c1c1c1",
    bg: theme.background ?? "#000000",
  };
}

/** Compose terminal name + git branch for the title bar. Falls back to
 *  a bare "terminal" label when metadata isn't available. */
function titleLabel(meta: TerminalMetadata | undefined): string {
  if (!meta) return "terminal";
  const name = terminalKey(meta).group;
  return meta.git?.branch ? `${name} (${meta.git.branch})` : name;
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Mix two hex colors in sRGB. Used for subtle chrome tints derived from
 *  the theme — the title-bar background and the window border. Unknown
 *  color strings fall back to black, so the mix result is just `b`. */
function mix(a: string, b: string, ratio: number): string {
  const pa = parseColor(a).unwrapOr(BLACK);
  const pb = parseColor(b).unwrapOr(BLACK);
  const r = Math.round(pa.r * (1 - ratio) + pb.r * ratio);
  const g = Math.round(pa.g * (1 - ratio) + pb.g * ratio);
  const bl = Math.round(pa.b * (1 - ratio) + pb.b * ratio);
  return `rgb(${r},${g},${bl})`;
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

export function screenshotTerminal(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): UiAction {
  return Effect.gen(function* () {
    const refs = getTerminalRefs(id);
    if (!refs) {
      toast.error("Terminal not ready");
      return;
    }
    const xterm = refs.xterm as unknown as {
      cols: number;
      rows: number;
      options: {
        fontSize?: number;
        fontFamily?: string;
        theme?: Record<string, string | undefined>;
      };
    };

    const theme = resolveTheme(xterm.options.theme ?? {});
    const fontSize = xterm.options.fontSize ?? 14;
    const fontFamily = xterm.options.fontFamily ?? FONT_FAMILY;
    // Wait for webfonts — on the first screenshot after a cold page load,
    // @font-face declarations may not have finished loading. fillText would
    // silently fall back to the browser's default glyphs and produce an
    // image that visually mismatches the live terminal.
    if (document.fonts?.ready)
      yield* Effect.promise(() => document.fonts.ready);
    const logo = yield* loadBrandLogo.pipe(
      // The logo is decoration: a failed decode degrades the screenshot, it does
      // not fail it. Recovered to `undefined` — which the drawing below already
      // reads as "no logo" — rather than left to abort the copy.
      Effect.catch((err) =>
        Effect.sync((): HTMLImageElement | undefined => {
          console.warn(err.message);
          toast.warning(
            `Kolu logo unavailable; copying screenshot without it: ${err.message}`,
          );
          return undefined;
        }),
      ),
    );
    const cols = xterm.cols;
    const rows = xterm.rows;

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

    const live = refs.canvas;
    const termW =
      live.width > 0
        ? Math.ceil(live.width / (window.devicePixelRatio || 1))
        : Math.ceil(cellW * cols);
    const termH =
      live.height > 0
        ? Math.ceil(live.height / (window.devicePixelRatio || 1))
        : cellH * rows;
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
    for (const [i, color] of DOT_MACOS.entries()) {
      ctx.beginPath();
      ctx.arc(
        DOT_MARGIN_LEFT + i * (DOT_R * 2 + DOT_GAP),
        dotY,
        DOT_R,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Title text — centered, truncated to the available width.
    ctx.font = `${Math.round(fontSize * 0.95)}px ${fontFamily}`;
    ctx.fillStyle = titleTextColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const label = titleLabel(meta);
    ctx.fillText(label, logicalW / 2, dotY + 1);

    // Kolu branding — right-aligned wordmark + logo, matching /favicon.svg.
    // The stamp is subtle so it reads as attribution rather than a watermark.
    const brandText = "kolu";
    const brandFontSize = Math.round(fontSize * 0.9);
    ctx.font = `600 ${brandFontSize}px ${fontFamily}`;
    const brandTextWidth = ctx.measureText(brandText).width;
    const logoH = TITLE_H - 12;
    const logoW = logo
      ? logoH *
        ((logo.naturalWidth || logo.width) /
          (logo.naturalHeight || logo.height))
      : 0;
    const logoY = (TITLE_H - logoH) / 2;
    const brandTextX = logicalW - BRAND_RIGHT_MARGIN;
    const logoX = brandTextX - brandTextWidth - (logo ? 6 : 0) - logoW;
    ctx.textAlign = "end";
    ctx.fillStyle = titleTextColor;
    ctx.fillText(brandText, brandTextX, dotY + 1);
    if (logo) ctx.drawImage(logo, logoX, logoY, logoW, logoH);

    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    // Terminal content.
    const termX = PAD;
    const termY = TITLE_H + PAD;
    ctx.save();
    ctx.translate(termX, termY);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, termW, termH);

    if (live.width > 0 && live.height > 0) {
      ctx.drawImage(live, 0, 0, termW, termH);
    }
    ctx.restore();

    const blob = yield* Effect.callback<Blob | null>((resume) =>
      canvas.toBlob((b) => resume(Effect.succeed(b)), "image/png"),
    );
    if (!blob) {
      toast.error("Screenshot failed");
      return;
    }
    // Image writes have no execCommand equivalent — if navigator.clipboard
    // is undefined (plain-HTTP, non-localhost), the only honest answer is a
    // diagnostic toast. See `ui/clipboard.ts` for the text-write fallback.
    if (!navigator.clipboard?.write) {
      toast.error(
        "Screenshot-to-clipboard requires HTTPS or localhost — image writes have no fallback in non-secure contexts",
      );
      return;
    }
    yield* Effect.tryPromise(() =>
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]),
    ).pipe(
      Effect.tap(() => Effect.sync(() => toast.success("Screenshot copied"))),
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Screenshot failed: ${toError(err).message}`);
        }),
      ),
    );
  });
}
