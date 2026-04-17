/** Copy a terminal's contents to the clipboard as a PNG.
 *
 *  Serializes the terminal's buffer (scrollback + viewport) to themed HTML via
 *  xterm's SerializeAddon, mounts it offscreen in the document, rasterizes the
 *  node with html-to-image, and writes the PNG blob to the clipboard.
 *
 *  Buffer-to-HTML is renderer-independent: works on any tile regardless of
 *  whether it's WebGL-active or falling back to xterm's DOM renderer (non-
 *  focused canvas-mode tiles use DOM per the single-context budget in
 *  Terminal.tsx).
 *
 *  The offscreen host must be attached to document.body — html-to-image needs
 *  real layout to compute geometry — and is removed in a finally block so a
 *  failure can't leak DOM nodes. */

import { toBlob } from "html-to-image";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { FONT_FAMILY } from "terminal-themes";
import { getTerminalRefs } from "./terminal/terminalRefs";

export async function screenshotTerminal(id: TerminalId): Promise<void> {
  const refs = getTerminalRefs(id);
  if (!refs) {
    toast.error("Terminal not ready");
    return;
  }
  const bodyHtml = refs.serialize.serializeAsHTML({
    includeGlobalBackground: true,
  });
  const theme = refs.xterm.options.theme ?? {};
  const fg = theme.foreground ?? "#000000";
  const bg = theme.background ?? "#ffffff";

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.fontFamily = FONT_FAMILY;
  host.style.color = fg;
  host.style.backgroundColor = bg;
  host.style.whiteSpace = "pre";
  host.style.padding = "12px";
  host.style.fontVariantLigatures = "none";
  host.innerHTML = bodyHtml;
  document.body.appendChild(host);
  try {
    const blob = await toBlob(host, { pixelRatio: window.devicePixelRatio });
    if (!blob) {
      toast.error("Screenshot failed");
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Screenshot copied");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(`Screenshot failed: ${msg}`);
  } finally {
    host.remove();
  }
}
