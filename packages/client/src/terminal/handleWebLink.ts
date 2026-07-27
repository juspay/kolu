/**
 * Web-link activation policy for a kolu terminal — lives beside
 * `fileRefLinkProvider` for the same reason: xterm-kit owns the generic seam,
 * kolu owns what a click *means*.
 *
 *   - loopback URL → the join card at the cursor
 *   - ⌘/ctrl-click → raw open, no card
 *   - non-loopback → default open, untouched
 */

import { parseLoopbackUrl } from "@kolu/url-shape";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { closePrintedUrlCard, openPrintedUrlCard } from "./printedUrlCardState";

/** Open a URL the way the default WebLinksAddon would — new tab, opener severed. */
export function openRawUrl(uri: string): void {
  const tab = window.open(uri, "_blank");
  if (tab === null) {
    toast.info("Your browser blocked the new tab.", {
      description: uri,
    });
    return;
  }
  try {
    tab.opener = null;
  } catch {
    // Electron can throw; ignore.
  }
}

/** Handle a web-link click for `terminalId`. */
export function handleWebLink(
  event: MouseEvent,
  uri: string,
  terminalId: TerminalId,
): void {
  // ⌘/ctrl-click: raw open, no card — the escape hatch for "I really mean my
  // own machine's localhost".
  if (event.metaKey || event.ctrlKey) {
    closePrintedUrlCard();
    openRawUrl(uri);
    return;
  }
  const loopback = parseLoopbackUrl(uri);
  if (loopback === null) {
    openRawUrl(uri);
    return;
  }
  openPrintedUrlCard({
    terminalId,
    uri,
    port: loopback.port,
    protocol: loopback.protocol,
    pathname: loopback.pathname,
    search: loopback.search,
    hash: loopback.hash,
    x: event.clientX,
    y: event.clientY,
  });
}
