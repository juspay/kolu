/** Export a terminal's FULL on-disk history as a printable PDF (PR2).
 *
 *  Streams the un-clipped transcript from the server (`terminal.exportHistory`,
 *  faithful per-resize-epoch at the historical width), renders each segment in an
 *  OFFSCREEN themed xterm + SerializeAddon, and writes the resulting HTML
 *  segment-by-segment STRAIGHT INTO the print window's document. The HTML is
 *  never accumulated into an array + joined into a body + embedded into a third
 *  doc string (the old triple-buffer that, under the 256 MiB history cap, could
 *  OOM the browser even though the server side streams) — only one segment's
 *  HTML is live in JS at a time (F5). Depth lives on the server; the theme stays
 *  client-side (the server's headless xterm has no theme).
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

/** Stream the export segments through an offscreen themed xterm, handing each
 *  segment's serialized HTML to `sink` as it is produced (never held all at
 *  once). Each segment is serialized at its own historical width, so a 200-col
 *  table is never re-wrapped narrow. Returns whether any segment was written —
 *  `false` means the transcript is empty (history disabled). */
async function streamHistoryHtml(
  id: TerminalId,
  theme: ITheme,
  sink: (html: string) => void,
): Promise<boolean> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:1200px;height:400px;visibility:hidden";
  document.body.appendChild(host);
  const term = new XTerm({
    cols: 80,
    rows: 24,
    // A single resize-epoch segment is replayed whole (term.reset() per segment),
    // so this must clear the largest segment — bounded only by the server's
    // history cap, not a small per-page constant; hence the high ceiling.
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
  let wrote = false;
  try {
    const segs = await streamCall(client.terminal.exportHistory, { id });
    for await (const seg of segs) {
      term.reset();
      // cols/rows are contract-guaranteed positive — render directly.
      term.resize(seg.cols, seg.rows);
      await write(seg.ansi);
      sink(serialize.serializeAsHTML({ includeGlobalBackground: true }));
      wrote = true;
    }
  } finally {
    term.dispose();
    host.remove();
  }
  return wrote;
}

export async function exportScrollbackAsPdf(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): Promise<void> {
  const refs = getTerminalRefs(id);
  const theme = refs?.xterm.options.theme ?? {};
  const bg = theme.background ?? "#ffffff";
  const fg = theme.foreground ?? "#000000";
  const label = meta?.git
    ? `${meta.git.repoName} (${meta.git.branch})`
    : meta
      ? terminalKey(meta).group
      : "Terminal";
  // Open the print window SYNCHRONOUSLY, in the click gesture, BEFORE the async
  // history read (F4). Browsers block a popup opened after an await, so the old
  // order (await the server render, then `window.open`) got blocked even for a
  // legitimate click. Write the document head now, then STREAM the body into the
  // already-open document as segments arrive (F5) — the browser paints them
  // incrementally and JS never holds the whole history. Close the window on
  // failure so a blocked/failed export never leaves a blank tab.
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Popup blocked — allow popups to export as PDF");
    return;
  }
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html>
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
  <body>`);

  try {
    const wrote = await streamHistoryHtml(id, theme, (html) => doc.write(html));
    // Fallback: history disabled for this terminal → export the visible client
    // buffer exactly as before (the correct behavior for an opted-out terminal).
    if (!wrote) {
      if (!refs) {
        win.close();
        toast.error("Terminal not ready");
        return;
      }
      doc.write(
        refs.serialize.serializeAsHTML({ includeGlobalBackground: true }),
      );
    }
  } catch (err) {
    win.close();
    console.error("Failed to read terminal history for PDF:", err);
    toast.error(`Failed to read history: ${(err as Error).message}`);
    return;
  }
  doc.write("</body></html>");
  doc.close();
  const print = () => {
    win.focus();
    win.print();
  };
  const fontsReady = doc.fonts?.ready;
  if (fontsReady) {
    fontsReady.then(print, print);
  } else {
    print();
  }
}
