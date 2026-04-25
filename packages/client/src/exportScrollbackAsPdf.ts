/** Export the active terminal's available scrollback as a printable PDF.
 *
 *  Serializes whatever the xterm ring buffer currently holds (scrollback +
 *  viewport — NOT the full session, which may have scrolled past the buffer
 *  cap) to themed HTML via xterm's SerializeAddon, opens it in a new window
 *  with the live theme and FiraCode Nerd Font applied, and triggers the
 *  browser print dialog. The user picks "Save as PDF" from there.
 *
 *  Client-side only — the server's headless xterm has no theme, so
 *  serializing there would produce unstyled HTML. */

import {
  type TerminalId,
  type TerminalMetadata,
  terminalKey,
} from "kolu-common";
import { toast } from "solid-sonner";
import { FONT_FAMILY } from "terminal-themes";
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
  // Prefer repo + branch from git metadata for the document title; fall back
  // to the canonical name (basename for non-git), then to "Terminal".
  const label = meta?.git
    ? `${meta.git.repoName} (${meta.git.branch})`
    : meta
      ? terminalKey(meta).group
      : "Terminal";
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
  // Wait for fonts to load before printing so glyph metrics are stable.
  // Fall through to print() on any fonts.ready failure — unstyled print is
  // still better than a silent no-op.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
