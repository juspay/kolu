/** A {@link SnapshotScene} as an SVG document.
 *
 *  The server-side half of the two backends — the browser's canvas painter is
 *  the other. SVG is the intermediate rather than a direct raster because it
 *  is a pure string: no canvas, no native binding, and the same output is
 *  testable as text (a golden SVG says exactly what moved when a layout
 *  change lands, where a golden PNG only says "some pixels differ").
 *
 *  Text is emitted one `<text>` per cell, matching {@link SceneGlyph}'s
 *  contract. That is not a missed batching optimisation — independent text
 *  elements are what stop the font's shaper from applying ligatures and
 *  kerning across cell boundaries, which is exactly the drift a terminal
 *  must not have.
 *
 *  The only string work this backend does is `escapeHtml` — turning `<`, `&`
 *  and `"` into entities, which is a fact about XML syntax and nothing else.
 *  DROPPING the code points no renderer can paint happens in `scene.ts`, where
 *  a cell's paintable characters are decided: doing it here made this backend
 *  the only one that did it, so the canvas painter drew an unpaired surrogate
 *  as U+FFFD and a C1 control as a box while the SVG drew nothing — two
 *  visibly different pictures from one scene. */

import { escapeHtml } from "@kolu/html-escape";
import type { SnapshotScene } from "./scene.ts";

/** Round to a tenth of a pixel. Full float coordinates make the document
 *  noticeably larger with no visible difference at raster time. */
function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** The window outline's rect attributes — its position, its size and its
 *  corner radius — spelled once for the three places that need the SAME
 *  shape: the clip path, the background fill, and the stroked border.
 *
 *  A `<rect rx>` rather than a hand-written arc path, and that is the whole
 *  point: `rx` is a true elliptical quarter-arc, and so is the canvas
 *  backend's `ctx.roundRect()`. This used to be an `A r,r` path here against a
 *  `quadraticCurveTo` there — a circular arc against a parabola, on the ONE
 *  piece of geometry neither backend read off the scene, and therefore the one
 *  place two backends could draw different pictures from the same scene. Both
 *  now name a platform primitive with the same definition rather than each
 *  approximating the corner in its own curve language.
 *
 *  `<rect rx>` is legal in all three positions — inside a `<clipPath>`, as a
 *  fill, and as the stroked outline — so the path builder bought nothing the
 *  primitive does not already give. */
function windowRect(scene: SnapshotScene): string {
  const { strokeInset, strokeWidth } = scene.window;
  return `x="${n(strokeInset)}" y="${n(strokeInset)}" width="${n(scene.width - strokeWidth)}" height="${n(scene.height - strokeWidth)}" rx="${n(scene.radius)}"`;
}

export function sceneToSvg(scene: SnapshotScene): string {
  const { font, titleBar } = scene;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}" height="${n(scene.height)}" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">`,
  );

  // A clip on the window shape, so the square title bar and the terminal
  // body both get the window's rounded corners without either knowing the
  // radius.
  parts.push(
    `<defs><clipPath id="win"><rect ${windowRect(scene)}/></clipPath></defs>`,
  );
  parts.push(`<g clip-path="url(#win)">`);
  parts.push(
    `<rect ${windowRect(scene)} fill="${scene.window.bg}"/>`,
    `<rect x="0" y="0" width="${n(scene.width)}" height="${n(titleBar.height)}" fill="${titleBar.bg}"/>`,
    `<rect x="0" y="${n(titleBar.height)}" width="${n(scene.width)}" height="1" fill="${scene.window.border}"/>`,
  );

  for (const dot of titleBar.dots) {
    parts.push(
      `<circle cx="${n(dot.cx)}" cy="${n(dot.cy)}" r="${n(dot.r)}" fill="${dot.fill}"/>`,
    );
  }

  // Both title-bar texts arrive positioned and sized by the scene — this
  // backend chooses none of it, which is what stops it drifting from the
  // canvas one. Only the wordmark's weight is a rendering flourish.
  for (const [t, weight] of [
    [titleBar.title, ""],
    [titleBar.brand, ` font-weight="600"`],
  ] as const) {
    parts.push(
      `<text x="${n(t.x)}" y="${n(t.y)}" font-family="${escapeHtml(font.family)}" font-size="${t.size}" fill="${titleBar.fg}" text-anchor="${t.anchor}" dominant-baseline="central"${weight}>${escapeHtml(t.text)}</text>`,
    );
  }

  // Terminal body: its own background, then the cell backgrounds that differ
  // from it, then the glyphs.
  parts.push(
    `<rect x="${n(scene.term.x)}" y="${n(scene.term.y)}" width="${n(scene.term.w)}" height="${n(scene.term.h)}" fill="${scene.term.fill}"/>`,
  );
  for (const r of scene.rects) {
    parts.push(
      `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${r.fill}"/>`,
    );
  }

  // The glyph baseline sits one font-size below the cell top, matching the
  // canvas backend's `fillText(chars, px, py + fontSize)`.
  const family = escapeHtml(font.family);
  for (const g of scene.glyphs) {
    const weight = g.bold ? ` font-weight="bold"` : "";
    const style = g.italic ? ` font-style="italic"` : "";
    parts.push(
      `<text x="${n(g.x)}" y="${n(g.y + font.size)}" font-family="${family}" font-size="${font.size}" fill="${g.fill}"${weight}${style}>${escapeHtml(g.text)}</text>`,
    );
  }

  parts.push(`</g>`);
  // The border is stroked LAST and outside the clip, so it is not half-eaten
  // by its own clip path the way a clipped stroke would be.
  parts.push(
    `<rect ${windowRect(scene)} fill="none" stroke="${scene.window.border}" stroke-width="${n(scene.window.strokeWidth)}"/>`,
  );
  parts.push(`</svg>`);
  return parts.join("");
}
