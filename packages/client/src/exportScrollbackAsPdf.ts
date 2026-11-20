import { escapeHtml } from "@kolu/html-escape";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { FONT_FAMILY } from "terminal-themes";
import { terminalExportTitle } from "./terminal/terminalDisplay";
import { getTerminalRefs } from "./terminal/terminalRefs";

export function exportScrollbackAsPdf(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): void {
  const refs = getTerminalRefs(id);
  if (!refs) {
    toast.error("Terminal not ready");
    return;
  }
  const bodyHtml = refs.serialize.serializeAsHTML({
    includeGlobalBackground: true,
  });
  const label = terminalExportTitle(meta);
  // Pull the active theme off the live xterm so the popup matches exactly
  // what the user sees — serializeAsHTML only emits a global background,
  // not a default foreground, so unset text would fall back to browser
  // black without this.
  const theme = refs.xterm.options.theme ?? {};
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
