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
 *  must not have. */

import { escapeHtml } from "@kolu/html-escape";
import type { SnapshotScene } from "./scene.ts";

/** Round to a tenth of a pixel. Full float coordinates make the document
 *  noticeably larger with no visible difference at raster time. */
function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** Code points XML 1.0 cannot carry at all — not even as an entity: the C0
 *  controls (bar tab/LF/CR, which a terminal cell never holds), DEL and the
 *  C1 block, and the two noncharacters at the end of the BMP.
 *
 *  Surrogates are matched only when UNPAIRED — `\p{Surrogate}` under the `u`
 *  flag never matches a well-formed pair, where a blanket `\uD800-\uDFFF`
 *  class would tear every astral glyph (emoji, and the CJK a wide cell
 *  holds) in half. */
const XML_ILLEGAL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]|\p{Surrogate}/gu;

/** Escape a string for XML text or an attribute value, first DROPPING the
 *  code points XML cannot carry.
 *
 *  A terminal cell holds whatever the PTY put there. A single stray control
 *  byte in the scrollback would otherwise make the whole document
 *  unparseable and fail every screenshot of that terminal — a
 *  disproportionate answer to one unprintable character that the live
 *  terminal itself renders as nothing. Dropping is not a silent degradation
 *  of a MEANINGFUL value: these code points have no glyph, so the picture is
 *  the same one xterm draws. */
function xml(s: string): string {
  return escapeHtml(s.replace(XML_ILLEGAL, ""));
}

/** The window outline as a rounded rect path. The inset comes off the scene —
 *  it is the same decision as the stroke width, and both backends used to
 *  spell it as a bare number of their own. */
function windowPath(scene: SnapshotScene): string {
  const { width, height, radius } = scene;
  const i = scene.window.strokeInset;
  return `M${n(radius + i)},${n(i)} H${n(width - radius - i)} A${radius},${radius} 0 0 1 ${n(width - i)},${n(radius + i)} V${n(height - radius - i)} A${radius},${radius} 0 0 1 ${n(width - radius - i)},${n(height - i)} H${n(radius + i)} A${radius},${radius} 0 0 1 ${n(i)},${n(height - radius - i)} V${n(radius + i)} A${radius},${radius} 0 0 1 ${n(radius + i)},${n(i)} Z`;
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
    `<defs><clipPath id="win"><path d="${windowPath(scene)}"/></clipPath></defs>`,
  );
  parts.push(`<g clip-path="url(#win)">`);
  parts.push(
    `<path d="${windowPath(scene)}" fill="${scene.window.bg}"/>`,
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
      `<text x="${n(t.x)}" y="${n(t.y)}" font-family="${xml(font.family)}" font-size="${t.size}" fill="${titleBar.fg}" text-anchor="${t.anchor}" dominant-baseline="central"${weight}>${xml(t.text)}</text>`,
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
  const family = xml(font.family);
  for (const g of scene.glyphs) {
    const weight = g.bold ? ` font-weight="bold"` : "";
    const style = g.italic ? ` font-style="italic"` : "";
    parts.push(
      `<text x="${n(g.x)}" y="${n(g.y + font.size)}" font-family="${family}" font-size="${font.size}" fill="${g.fill}"${weight}${style}>${xml(g.text)}</text>`,
    );
  }

  parts.push(`</g>`);
  // The border is stroked LAST and outside the clip, so it is not half-eaten
  // by its own clip path the way a clipped stroke would be.
  parts.push(
    `<path d="${windowPath(scene)}" fill="none" stroke="${scene.window.border}" stroke-width="${n(scene.window.strokeWidth)}"/>`,
  );
  parts.push(`</svg>`);
  return parts.join("");
}
