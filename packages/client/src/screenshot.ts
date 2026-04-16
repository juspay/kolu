/** Capture a terminal's rendered pixels and copy them to the clipboard as PNG.
 *
 *  WebGL quirk: with the default `preserveDrawingBuffer: false` (which we
 *  keep off because it doubles GPU memory per terminal — significant at
 *  many tiles), the WebGL drawing buffer is undefined after the browser
 *  compositor swaps it. A naive `drawImage(xtermCanvas, …)` at an
 *  arbitrary moment reads black.
 *
 *  The trick: xterm's `onRender` fires synchronously after its draw calls,
 *  inside the same `requestAnimationFrame` tick — before the compositor
 *  swap. Sampling in that window gets the real pixels without needing
 *  `preserveDrawingBuffer`. We force a render via `refresh()` and do the
 *  `drawImage` synchronously in the callback so the pixels land on our
 *  own 2D canvas (which isn't subject to the compositor) before the tick
 *  ends. `toBlob` can then finish encoding at its own pace.
 *
 *  The canvas-renderer fallback stacks layered `<canvas>` elements that
 *  are always readable; the same code path works for both renderers. */

import { toast } from "solid-sonner";
import type { Terminal as XTerm, IDisposable } from "@xterm/xterm";
import type { TerminalId } from "kolu-common";
import { getTerminalRefs } from "./terminal/terminalRefs";

const RENDER_TIMEOUT_MS = 500;

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
    const blob = await captureTerminalBlob(refs.xterm);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Screenshot copied to clipboard", { id: toastId });
  } catch (err) {
    toast.error(`Failed to copy screenshot: ${(err as Error).message}`, {
      id: toastId,
    });
  }
}

function captureTerminalBlob(term: XTerm): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let disposable: IDisposable | null = null;
    const timer = setTimeout(() => {
      disposable?.dispose();
      reject(new Error("xterm render did not complete"));
    }, RENDER_TIMEOUT_MS);

    disposable = term.onRender(() => {
      disposable?.dispose();
      clearTimeout(timer);
      try {
        // drawImage MUST run synchronously here — once the rAF tick ends
        // and the compositor swaps the WebGL buffer, the xterm canvas
        // reads blank. Our output canvas keeps the pixels independently,
        // so toBlob can encode asynchronously after this point.
        const out = compositeToCanvas(term);
        out.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("toBlob produced no data")),
          "image/png",
        );
      } catch (err) {
        reject(err);
      }
    });

    term.refresh(0, term.rows - 1);
  });
}

/** Composite xterm's renderer canvas(es) onto a fresh 2D canvas. */
function compositeToCanvas(term: XTerm): HTMLCanvasElement {
  const screen = term.element?.querySelector(
    ".xterm-screen",
  ) as HTMLElement | null;
  if (!screen) throw new Error("xterm screen element not found");
  const layers = Array.from(
    screen.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];
  if (layers.length === 0) throw new Error("xterm canvas not found");

  const base = layers[0]!;
  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Paint theme background first so transparent regions in the WebGL canvas
  // (or gaps between layered canvases) don't show the page behind.
  ctx.fillStyle = term.options.theme?.background ?? "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  for (const layer of layers) ctx.drawImage(layer, 0, 0);
  return out;
}
