/** Export a terminal's FULL on-disk history as a printable PDF (PR2).
 *
 *  Streams the un-clipped transcript from the server (`terminal.exportHistory`,
 *  faithful per-resize-epoch at the historical width) and renders each segment
 *  into an OFFSCREEN themed xterm + SerializeAddon, accumulating
 *  `serializeAsHTML()`. Depth moves to the server (no longer clipped to the live
 *  client ring); the theme stays client-side (the server's headless xterm has no
 *  theme). Opens the themed result in a print window — the user picks "Save as
 *  PDF".
 *
 *  Falls back to the live client-ring serialize ONLY when the transcript has no
 *  segments (history disabled for this terminal) — exporting the visible buffer
 *  is the correct behavior for an opted-out terminal, not a swallowed error. */

import { SerializeAddon } from "@xterm/addon-serialize";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { escapeHtml } from "@kolu/html-escape";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { terminalKey } from "kolu-common/terminalKey";
import { streamCall } from "@kolu/surface/solid";
import { toast } from "solid-sonner";
import { FONT_FAMILY } from "terminal-themes";
import { getTerminalRefs } from "./terminal/terminalRefs";
import { client } from "./wire";

/** Render the streamed export segments into an offscreen themed xterm and return
 *  the accumulated themed HTML, or `null` when the transcript is empty (history
 *  disabled). Each segment is serialized at its own historical width, so a
 *  200-col table is never re-wrapped to a narrow width. */
async function renderHistoryHtml(
  id: TerminalId,
  theme: ITheme,
): Promise<string | null> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:1200px;height:400px;visibility:hidden";
  document.body.appendChild(host);
  const term = new XTerm({
    cols: 80,
    rows: 24,
    scrollback: 5_000_000,
    theme,
    fontFamily: FONT_FAMILY,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  term.open(host);
  const write = (data: string): Promise<void> =>
    new Promise((r) => term.write(data, r));
  const parts: string[] = [];
  try {
    const segs = await streamCall(client.terminal.exportHistory, { id });
    for await (const seg of segs) {
      term.reset();
      term.resize(Math.max(1, seg.cols), Math.max(1, seg.rows));
      await write(seg.ansi);
      parts.push(serialize.serializeAsHTML({ includeGlobalBackground: true }));
    }
  } finally {
    term.dispose();
    host.remove();
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export async function exportScrollbackAsPdf(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): Promise<void> {
  const refs = getTerminalRefs(id);
  const theme = refs?.xterm.options.theme ?? {};
  let bodyHtml: string | null = null;
  try {
    bodyHtml = await renderHistoryHtml(id, theme);
  } catch (err) {
    console.error("Failed to read terminal history for PDF:", err);
    toast.error(`Failed to read history: ${(err as Error).message}`);
    return;
  }
  // Fallback: history disabled for this terminal → export the visible client
  // buffer exactly as before (the correct behavior for an opted-out terminal).
  if (bodyHtml === null) {
    if (!refs) {
      toast.error("Terminal not ready");
      return;
    }
    bodyHtml = refs.serialize.serializeAsHTML({
      includeGlobalBackground: true,
    });
  }
  const label = meta?.git
    ? `${meta.git.repoName} (${meta.git.branch})`
    : meta
      ? terminalKey(meta).group
      : "Terminal";
  const fg = theme.foreground ?? "#000000";
  const bg = theme.background ?? "#ffffff";
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Popup blocked — allow popups to export as PDF");
    return;
  }
  const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(label)} — kolu export</title>
    <link rel="stylesheet" href="/fonts/fonts.css" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ${FONT_FAMILY};
        color: ${fg};
        background-color: ${bg};
        white-space: pre;
        font-variant-ligatures: none;
      }
      @page { margin: 1cm; }
      @media print {
        html, body { background-color: ${bg}; }
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
  win.document.open();
  win.document.write(doc);
  win.document.close();
  const print = () => {
    win.focus();
    win.print();
  };
  const fontsReady = win.document.fonts?.ready;
  if (fontsReady) {
    fontsReady.then(print, print);
  } else {
    print();
  }
}
