/** Capture a terminal's rendered pixels and copy them to the clipboard as PNG.
 *
 *  Client-side only — walks the xterm DOM to find its rendering canvas(es)
 *  (WebGL uses a single canvas; the canvas fallback renderer stacks several
 *  layers), composites them onto a fresh canvas, and writes the result to
 *  the clipboard via `navigator.clipboard.write`. The WebGL path relies on
 *  `preserveDrawingBuffer: true` at addon construction (see Terminal.tsx)
 *  — without it, the canvas reads blank after the browser compositor swap. */

import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { getTerminalRefs } from "./terminal/terminalRefs";

export async function copyTerminalScreenshot(id: TerminalId): Promise<void> {
  const refs = getTerminalRefs(id);
  if (!refs) {
    toast.error("Terminal not ready");
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    toast.error("Clipboard image write not supported in this browser");
    return;
  }

  const toastId = toast.loading("Capturing screenshot…");
  try {
    const blob = await captureTerminalBlob(refs.xterm.element, refs.xterm);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Screenshot copied to clipboard", { id: toastId });
  } catch (err) {
    toast.error(`Failed to copy screenshot: ${(err as Error).message}`, {
      id: toastId,
    });
  }
}

/** Composite the xterm renderer canvases into a PNG blob. */
async function captureTerminalBlob(
  root: HTMLElement | undefined,
  xterm: { options: { theme?: { background?: string } } },
): Promise<Blob> {
  const screen = root?.querySelector(".xterm-screen") as HTMLElement | null;
  if (!screen) throw new Error("xterm screen element not found");
  const layers = Array.from(
    screen.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];
  if (layers.length === 0) throw new Error("xterm canvas not found");

  // WebGL renders everything to a single canvas; the canvas fallback
  // renderer has stacked layers that all share the same pixel dimensions.
  const base = layers[0]!;
  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Paint the theme background first so transparent regions in the WebGL
  // canvas (or gaps between layered canvases) don't show the page behind.
  ctx.fillStyle = xterm.options.theme?.background ?? "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  for (const layer of layers) ctx.drawImage(layer, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("toBlob produced no data")),
      "image/png",
    );
  });
}
