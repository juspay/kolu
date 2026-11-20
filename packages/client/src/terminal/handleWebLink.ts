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
  tab.opener = null;
}

/** Handle a web-link click for `terminalId`. */
export function handleWebLink(
  event: MouseEvent,
  uri: string,
  terminalId: TerminalId,
): void {
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
