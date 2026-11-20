import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import {
  buildScene,
  cellHeight,
  type ReadableBuffer,
  readGrid,
  type SnapshotScene,
} from "terminal-snapshot";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  FONT_FAMILY,
  type ITheme,
} from "terminal-themes";
import type { UiAction } from "./runAction";
import { terminalExportTitle } from "./terminal/terminalDisplay";
import { getTerminalRefs } from "./terminal/terminalRefs";

const BRAND = "kolu";

const BRAND_LOGO_URL = new URL("../favicon.svg", import.meta.url).href;
let brandLogo: HTMLImageElement | undefined;
const brandLogoOnceSucceeded: Effect.Effect<HTMLImageElement, Error> =
  Effect.suspend(() =>
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

function textAlignOf(
  anchor: SnapshotScene["titleBar"]["title"]["anchor"],
): CanvasTextAlign {
  return anchor === "end" ? "end" : "center";
}

function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: SnapshotScene,
  logo: HTMLImageElement | undefined,
): void {
  const { font, titleBar } = scene;
  const { outline: box, strokeWidth } = scene.window;
  const outline = () => {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, scene.radius);
  };

  outline();
  ctx.fillStyle = scene.window.bg;
  ctx.fill();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = scene.window.border;
  ctx.stroke();

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

  const { title, brand } = titleBar;
  ctx.font = `${title.size}px ${font.family}`;
  ctx.fillStyle = titleBar.fg;
  ctx.textBaseline = "middle";
  ctx.textAlign = textAlignOf(title.anchor);
  ctx.fillText(title.text, title.x, title.y);

  ctx.font = `600 ${brand.size}px ${font.family}`;
  const brandTextWidth = ctx.measureText(brand.text).width;
  const logoH = titleBar.height - 12;
  const logoW = logo
    ? logoH *
      ((logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height))
    : 0;
  const logoY = (titleBar.height - logoH) / 2;
  const logoX = brand.x - brandTextWidth - (logo ? 6 : 0) - logoW;
  ctx.textAlign = textAlignOf(brand.anchor);
  ctx.fillStyle = titleBar.fg;
  ctx.fillText(brand.text, brand.x, brand.y);
  if (logo) ctx.drawImage(logo, logoX, logoY, logoW, logoH);

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

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
      buffer: { active: ReadableBuffer & { viewportY: number } };
    };

    const fontSize = xterm.options.fontSize ?? DEFAULT_FONT_SIZE;
    const fontFamily = xterm.options.fontFamily ?? FONT_FAMILY;
    if (document.fonts?.ready)
      yield* Effect.promise(() => document.fonts.ready);
    const logo = yield* brandLogoOnceSucceeded.pipe(
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

    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) {
      toast.error("Canvas unavailable");
      return;
    }
    probe.font = `${fontSize}px ${fontFamily}`;
    const cellW = Math.max(1, probe.measureText("M").width);
    const cellH = cellHeight(fontSize);

    const buffer = xterm.buffer.active;
    const grid = readGrid(buffer, xterm.cols, buffer.viewportY, xterm.rows);
    const scene = buildScene({
      grid,
      theme: xterm.options.theme ?? DEFAULT_THEME,
      label: terminalExportTitle(meta),
      brand: BRAND,
      fontFamily,
      fontSize,
      cellW,
      cellH,
    });

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
