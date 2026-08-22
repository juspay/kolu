/** Copy the active terminal viewport to the clipboard as a polished PNG.
 *
 *  Reads the currently-visible slice of `xterm.buffer.active` — `xterm.rows`
 *  lines starting at `buffer.viewportY` — hands it to `terminal-snapshot` to
 *  be laid out, and paints the resulting scene onto an offscreen canvas.
 *  Scrollback above the viewport is not captured; if the user has scrolled
 *  up, the capture is WYSIWYG with what they're looking at.
 *
 *  This module decides NOTHING about layout, palette resolution or window
 *  chrome geometry — `terminal-snapshot`'s `buildScene` decides all three,
 *  once, and the daemon's SVG backend executes the same answer. That is why
 *  "the browser's screenshot and the agent's screenshot look the same" is
 *  true by construction rather than by two code paths being kept in
 *  agreement by prose. What is left here is exactly what only a browser can
 *  do: measure the font it will actually draw with, wait for webfonts,
 *  decode the brand logo, upscale for devicePixelRatio, and write a blob to
 *  the clipboard.
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
import { DEFAULT_FONT_SIZE } from "kolu-common/config";
import {
  buildScene,
  cellHeight,
  type ReadableBuffer,
  readGrid,
  type SnapshotScene,
} from "terminal-snapshot";
import { DEFAULT_THEME, FONT_FAMILY, type ITheme } from "terminal-themes";
import type { UiAction } from "./runAction";
import { getTerminalRefs } from "./terminal/terminalRefs";

/** The wordmark stamped in the title bar. A scene input rather than something
 *  the shared package knows: whose product this is, is not a fact about a
 *  terminal grid. */
const BRAND = "kolu";

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

/** Compose terminal name + git branch for the title bar. Falls back to
 *  a bare "terminal" label when metadata isn't available.
 *
 *  Stays here rather than in the shared package: it reads kolu's own
 *  `TerminalMetadata`, which a generic scene builder has no business
 *  knowing. The scene takes the finished string as its `label`. */
function titleLabel(meta: TerminalMetadata | undefined): string {
  if (!meta) return "terminal";
  const name = terminalKey(meta).group;
  return meta.git?.branch ? `${name} (${meta.git.branch})` : name;
}

/** Execute a scene against a 2D context. A dumb executor by design: every
 *  colour and every coordinate is read straight off the scene, never
 *  re-derived here — the moment this function computes a position, the
 *  browser and the daemon can disagree again.
 *
 *  The one thing the scene deliberately does not carry is the brand logo: it
 *  is a decoded raster, which only a browser has. Even that is placed against
 *  `scene.titleBar.brand` — the wordmark's own anchor — so the logo lands on
 *  the geometry the shared package owns rather than on a margin re-derived
 *  here. */
function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: SnapshotScene,
  logo: HTMLImageElement | undefined,
): void {
  const { font, titleBar } = scene;
  // The outline's inset and stroke width are the scene's, not this backend's —
  // they were two literals here and two more in the SVG writer, which is the
  // drift the scene exists to prevent.
  const { strokeInset, strokeWidth } = scene.window;
  // `ctx.roundRect` — the platform primitive — rather than a hand-built path.
  // Its corner is a true elliptical quarter-arc, which is exactly what the SVG
  // backend's `<rect rx>` draws. The two used to be a `quadraticCurveTo` here
  // (a parabola) against an `A r,r` arc there: the ONE piece of geometry
  // neither backend took off the scene, and so the one place they could draw
  // different pictures from the same scene.
  const outline = () => {
    ctx.beginPath();
    ctx.roundRect(
      strokeInset,
      strokeInset,
      scene.width - strokeWidth,
      scene.height - strokeWidth,
      scene.radius,
    );
  };

  outline();
  ctx.fillStyle = scene.window.bg;
  ctx.fill();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = scene.window.border;
  ctx.stroke();

  // Title bar: a square strip clipped to the window shape, so it inherits
  // the rounded top corners without knowing the radius.
  ctx.save();
  outline();
  ctx.clip();
  ctx.fillStyle = titleBar.bg;
  ctx.fillRect(0, 0, scene.width, titleBar.height);
  ctx.fillStyle = scene.window.border;
  ctx.fillRect(0, titleBar.height, scene.width, 1);
  ctx.restore();

  for (const dot of titleBar.dots) {
    ctx.beginPath();
    ctx.arc(dot.cx, dot.cy, dot.r, 0, Math.PI * 2);
    ctx.fillStyle = dot.fill;
    ctx.fill();
  }

  // Title text — the scene decided where it goes and how big it is; this
  // reads those out rather than re-deriving them, so the two backends cannot
  // disagree about the title bar the way they once did about the wordmark's
  // right margin.
  const { title, brand } = titleBar;
  ctx.font = `${title.size}px ${font.family}`;
  ctx.fillStyle = titleBar.fg;
  ctx.textBaseline = "middle";
  ctx.textAlign = title.anchor === "middle" ? "center" : "end";
  ctx.fillText(title.text, title.x, title.y);

  // Kolu branding — right-aligned wordmark + logo, matching /favicon.svg.
  // The stamp is subtle so it reads as attribution rather than a watermark.
  // The LOGO is the one thing the scene cannot carry (a decoded raster is not
  // a value), so its placement is derived here — from the wordmark's own
  // measured width, which only a canvas knows.
  ctx.font = `600 ${brand.size}px ${font.family}`;
  const brandTextWidth = ctx.measureText(brand.text).width;
  const logoH = titleBar.height - 12;
  const logoW = logo
    ? logoH *
      ((logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height))
    : 0;
  const logoY = (titleBar.height - logoH) / 2;
  const logoX = brand.x - brandTextWidth - (logo ? 6 : 0) - logoW;
  ctx.textAlign = brand.anchor === "end" ? "end" : "center";
  ctx.fillStyle = titleBar.fg;
  ctx.fillText(brand.text, brand.x, brand.y);
  if (logo) ctx.drawImage(logo, logoX, logoY, logoW, logoH);

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  // Terminal body: the cell backgrounds that differ from the terminal
  // background, then the glyphs — both already in absolute scene coordinates,
  // so no translate and no per-cell arithmetic. The body's own background
  // needs no fill: it IS the window background (one `theme.bg`, not two
  // agreeing values), already painted over the whole rounded rect above.
  for (const rect of scene.rects) {
    ctx.fillStyle = rect.fill;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // One positioned draw per cell, never a run of text: a ligature font
  // (kolu's default is FiraCode) would otherwise slide `!=` and `=>` off the
  // grid. The baseline sits one font-size below the cell top, which is the
  // contract `SceneGlyph` states and the SVG backend also honours.
  for (const glyph of scene.glyphs) {
    const bold = glyph.bold ? "bold " : "";
    const italic = glyph.italic ? "italic " : "";
    ctx.font = `${italic}${bold}${font.size}px ${font.family}`;
    ctx.fillStyle = glyph.fill;
    ctx.fillText(glyph.text, glyph.x, glyph.y + font.size);
  }
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
        theme?: ITheme;
      };
      // xterm's `IBuffer` satisfies `ReadableBuffer` structurally; `viewportY`
      // is the one field beyond it that this capture needs.
      buffer: { active: ReadableBuffer & { viewportY: number } };
    };

    const fontSize = xterm.options.fontSize ?? DEFAULT_FONT_SIZE;
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

    // Measure a cell using a probe canvas. A fresh 2d context inherits the
    // browser's default font; we set it explicitly before measuring. This is
    // the half of the layout only a backend can answer — hence `cellW`/`cellH`
    // being scene INPUTS rather than something `buildScene` computes.
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) {
      toast.error("Canvas unavailable");
      return;
    }
    probe.font = `${fontSize}px ${fontFamily}`;
    const cellW = Math.max(1, probe.measureText("M").width);
    // Row height comes from the shared package, not from a formula re-spelled
    // here: it is the one derivation both backends must land on.
    const cellH = cellHeight(fontSize);

    const buffer = xterm.buffer.active;
    // The VISIBLE slice only: `xterm.rows` lines from `viewportY`. Reading
    // from line 0 would capture the whole scrollback.
    const grid = readGrid(buffer, xterm.cols, buffer.viewportY, xterm.rows);
    const scene = buildScene({
      grid,
      // The daemon's absent-theme arm is `getThemeByName(undefined)`, i.e.
      // kolu's DEFAULT_THEME. Landing on the same theme is what keeps "both
      // backends draw the same picture" true for the no-theme case too — an
      // empty theme here would have been filled from a different table.
      theme: xterm.options.theme ?? DEFAULT_THEME,
      label: titleLabel(meta),
      brand: BRAND,
      fontFamily,
      fontSize,
      cellW,
      cellH,
    });

    // Upscale the backing store by devicePixelRatio so glyphs and chrome
    // render at native resolution on HiDPI displays. All draw commands
    // continue to operate in logical (CSS) pixels — the scene's own units —
    // after ctx.scale.
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(scene.width * dpr);
    canvas.height = Math.ceil(scene.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Canvas unavailable");
      return;
    }
    ctx.scale(dpr, dpr);

    paintScene(ctx, scene, logo);

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
