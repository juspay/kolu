import { escapeHtml } from "@kolu/html-escape";
import type { SnapshotScene } from "./scene.ts";

function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function windowRect(scene: SnapshotScene): string {
  const { x, y, w, h } = scene.window.outline;
  return `x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(scene.radius)}"`;
}

export function sceneToSvg(scene: SnapshotScene): string {
  const { font, titleBar } = scene;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}" height="${n(scene.height)}" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">`,
  );

  parts.push(
    `<defs><clipPath id="win"><rect ${windowRect(scene)}/></clipPath></defs>`,
  );
  parts.push(
    `<g clip-path="url(#win)" font-family="${escapeHtml(font.family)}" font-size="${font.size}">`,
  );
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

  for (const [t, weight] of [
    [titleBar.title, ""],
    [titleBar.brand, ` font-weight="600"`],
  ] as const) {
    parts.push(
      `<text x="${n(t.x)}" y="${n(t.y)}" font-size="${t.size}" fill="${titleBar.fg}" text-anchor="${t.anchor}" dominant-baseline="central"${weight}>${escapeHtml(t.text)}</text>`,
    );
  }

  for (const r of scene.rects) {
    parts.push(
      `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${r.fill}"/>`,
    );
  }

  for (const g of scene.glyphs) {
    const weight = g.bold ? ` font-weight="bold"` : "";
    const style = g.italic ? ` font-style="italic"` : "";
    parts.push(
      `<text x="${n(g.x)}" y="${n(g.y + font.size)}" fill="${g.fill}"${weight}${style}>${escapeHtml(g.text)}</text>`,
    );
  }

  parts.push(`</g>`);
  parts.push(
    `<rect ${windowRect(scene)} fill="none" stroke="${scene.window.border}" stroke-width="${n(scene.window.strokeWidth)}"/>`,
  );
  parts.push(`</svg>`);
  return parts.join("");
}
